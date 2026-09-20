import { NextResponse } from "next/server";
import { db, query } from "@/lib/db";
import {
  broadcastPreparedCollection,
  confirmPreparedCollection,
  currentBlockHeight,
  prepareCreatorFeeCollection,
  readCollectionResult,
  type PreparedCollection,
} from "@/lib/pump-server";

type CollectionRow = {
  signature: string;
  serialized_tx: string | null;
  recent_blockhash: string | null;
  last_valid_block_height: string | null;
  status: "PREPARED" | "SENT";
};

function authorized(request: Request) {
  const expected = process.env.INTERNAL_API_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied === expected);
}

async function setStatus(
  signature: string,
  status: "SENT" | "FAILED" | "EXPIRED",
  error?: string,
) {
  await query(
    `update collections
     set status=$1,error=$2
     where signature=$3 and status in ('PREPARED','SENT')`,
    [status, error || null, signature],
  );
}

async function finalize(
  signature: string,
  solAmountBaseUnits: bigint,
  usdcAmountBaseUnits: bigint,
) {
  const client = await db().connect();
  try {
    await client.query("begin");
    const updated = await client.query(
      `update collections
       set sol_amount_base_units=$1,
           usdc_amount_base_units=$2,
           status='CONFIRMED',
           error=null,
           confirmed_at=coalesce(confirmed_at,now())
       where signature=$3
         and status in ('PREPARED','SENT','CONFIRMED')
       returning id`,
      [
        solAmountBaseUnits.toString(),
        usdcAmountBaseUnits.toString(),
        signature,
      ],
    );

    if (!updated.rowCount) {
      throw new Error("Collection journal row was not found during finalization");
    }

    await client.query(
      `insert into audit_log(event_type,subject_type,subject_id,payload)
       values('TREASURY_COLLECTION_CONFIRMED','COLLECTION',$1,$2::jsonb)`,
      [
        signature,
        JSON.stringify({
          signature,
          solAmountBaseUnits: solAmountBaseUnits.toString(),
          usdcAmountBaseUnits: usdcAmountBaseUnits.toString(),
        }),
      ],
    );
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

async function recoverOpenCollection() {
  const existing = await query<CollectionRow>(
    `select signature,serialized_tx,recent_blockhash,
            last_valid_block_height::text,status
     from collections
     where status in ('PREPARED','SENT')
     order by created_at asc
     limit 1`,
  );

  if (!existing.rowCount) return { recovered: false as const };

  const attempt = existing.rows[0];
  const onChain = await readCollectionResult(attempt.signature, 2);

  if (onChain.found) {
    if (!onChain.ok) {
      await setStatus(
        attempt.signature,
        "FAILED",
        onChain.error || "On-chain collection failed",
      );
      return { recovered: false as const, failed: attempt.signature };
    }

    await finalize(
      attempt.signature,
      onChain.solAmountBaseUnits,
      onChain.usdcAmountBaseUnits,
    );
    return {
      recovered: true as const,
      signature: attempt.signature,
      solAmountBaseUnits: onChain.solAmountBaseUnits,
      usdcAmountBaseUnits: onChain.usdcAmountBaseUnits,
    };
  }

  if (
    !attempt.serialized_tx ||
    !attempt.recent_blockhash ||
    !attempt.last_valid_block_height
  ) {
    await setStatus(attempt.signature, "FAILED", "Incomplete collection journal");
    return { recovered: false as const, failed: attempt.signature };
  }

  const lastValidBlockHeight = Number(attempt.last_valid_block_height);
  if ((await currentBlockHeight()) > lastValidBlockHeight) {
    await setStatus(
      attempt.signature,
      "EXPIRED",
      "Transaction blockhash expired before confirmation",
    );
    return { recovered: false as const, expired: attempt.signature };
  }

  const prepared: PreparedCollection = {
    signature: attempt.signature,
    serializedTx: attempt.serialized_tx,
    blockhash: attempt.recent_blockhash,
    lastValidBlockHeight,
  };

  await broadcastPreparedCollection(prepared);
  await setStatus(prepared.signature, "SENT");
  await confirmPreparedCollection(prepared);

  const confirmed = await readCollectionResult(prepared.signature, 4);
  if (!confirmed.found) {
    throw new Error("Collection confirmed but receipt is not indexed yet");
  }
  if (!confirmed.ok) {
    await setStatus(
      prepared.signature,
      "FAILED",
      confirmed.error || "On-chain collection failed",
    );
    return { recovered: false as const, failed: prepared.signature };
  }

  await finalize(
    prepared.signature,
    confirmed.solAmountBaseUnits,
    confirmed.usdcAmountBaseUnits,
  );

  return {
    recovered: true as const,
    signature: prepared.signature,
    solAmountBaseUnits: confirmed.solAmountBaseUnits,
    usdcAmountBaseUnits: confirmed.usdcAmountBaseUnits,
  };
}

async function collect() {
  const recovery = await recoverOpenCollection();
  if (recovery.recovered) return recovery;

  const prepared = await prepareCreatorFeeCollection();

  await query(
    `insert into collections(
       signature,status,serialized_tx,recent_blockhash,last_valid_block_height
     ) values($1,'PREPARED',$2,$3,$4)
     on conflict(signature) do nothing`,
    [
      prepared.signature,
      prepared.serializedTx,
      prepared.blockhash,
      prepared.lastValidBlockHeight,
    ],
  );

  await broadcastPreparedCollection(prepared);
  await setStatus(prepared.signature, "SENT");
  await confirmPreparedCollection(prepared);

  const confirmed = await readCollectionResult(prepared.signature, 4);
  if (!confirmed.found) {
    throw new Error("Collection confirmed but receipt is not indexed yet");
  }
  if (!confirmed.ok) {
    await setStatus(
      prepared.signature,
      "FAILED",
      confirmed.error || "On-chain collection failed",
    );
    throw new Error("Creator-fee collection failed on-chain");
  }

  await finalize(
    prepared.signature,
    confirmed.solAmountBaseUnits,
    confirmed.usdcAmountBaseUnits,
  );

  return {
    recovered: false as const,
    signature: prepared.signature,
    solAmountBaseUnits: confirmed.solAmountBaseUnits,
    usdcAmountBaseUnits: confirmed.usdcAmountBaseUnits,
  };
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lockClient = await db().connect();
  let locked = false;

  try {
    const lock = await lockClient.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtext('GOFUND_COLLECTION')) as locked",
    );
    locked = Boolean(lock.rows[0]?.locked);

    if (!locked) {
      return NextResponse.json({
        ok: true,
        skipped: "collection already in progress",
      });
    }

    const result = await collect();
    return NextResponse.json({
      ok: true,
      signature: result.signature,
      recovered: result.recovered,
      solAmountBaseUnits: result.solAmountBaseUnits.toString(),
      usdcAmountBaseUnits: result.usdcAmountBaseUnits.toString(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "collection failed" },
      { status: 500 },
    );
  } finally {
    if (locked) {
      await lockClient
        .query("select pg_advisory_unlock(hashtext('GOFUND_COLLECTION'))")
        .catch(() => undefined);
    }
    lockClient.release();
  }
}
