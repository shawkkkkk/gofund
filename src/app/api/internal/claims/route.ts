import { NextResponse } from "next/server";
import { db, query } from "@/lib/db";
import {
  broadcastPreparedDistribution,
  confirmPreparedDistribution,
  currentBlockHeight,
  prepareCreatorFeeDistribution,
  readDistributionResult,
  verifyDirectCreatorRouting,
  type PreparedDistribution,
} from "@/lib/pump-server";

type TokenRow = {
  id: string;
  mint: string;
  quote_asset: "SOL" | "USDC";
};

type ClaimRow = {
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

async function setAttemptStatus(
  signature: string,
  status: "SENT" | "FAILED" | "EXPIRED",
  error?: string,
) {
  await query(
    `update claims
     set status = $1,
         error = $2
     where signature = $3
       and status in ('PREPARED','SENT')`,
    [status, error || null, signature],
  );
}

async function finalizeClaim(
  token: TokenRow,
  signature: string,
  amountBaseUnits: bigint,
) {
  const client = await db().connect();
  try {
    await client.query("begin");
    const updated = await client.query(
      `update claims
       set amount_base_units = $1,
           status = 'CONFIRMED',
           error = null,
           confirmed_at = coalesce(confirmed_at, now())
       where signature = $2
         and token_id = $3
         and status in ('PREPARED','SENT','CONFIRMED')
       returning id`,
      [amountBaseUnits.toString(), signature, token.id],
    );

    if (!updated.rowCount) {
      throw new Error("Claim journal row was not found during finalization");
    }

    await client.query(
      `insert into audit_log(event_type,subject_type,subject_id,payload)
       values('CLAIM_CONFIRMED','TOKEN',$1,$2::jsonb)`,
      [
        token.mint,
        JSON.stringify({
          signature,
          asset: token.quote_asset,
          amountBaseUnits: amountBaseUnits.toString(),
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

async function recoverOpenAttempt(token: TokenRow) {
  const existing = await query<ClaimRow>(
    `select signature,serialized_tx,recent_blockhash,last_valid_block_height::text,status
     from claims
     where token_id = $1
       and status in ('PREPARED','SENT')
     order by created_at asc
     limit 1`,
    [token.id],
  );

  if (!existing.rowCount) return { recovered: false as const };

  const attempt = existing.rows[0];
  const onChain = await readDistributionResult(
    attempt.signature,
    token.quote_asset,
    2,
  );

  if (onChain.found) {
    if (!onChain.ok) {
      await setAttemptStatus(
        attempt.signature,
        "FAILED",
        onChain.error || "On-chain transaction failed",
      );
      return { recovered: false as const, failedAttempt: attempt.signature };
    }

    await finalizeClaim(token, attempt.signature, onChain.amountBaseUnits);
    return {
      recovered: true as const,
      signature: attempt.signature,
      amountBaseUnits: onChain.amountBaseUnits,
    };
  }

  if (
    !attempt.serialized_tx ||
    !attempt.recent_blockhash ||
    !attempt.last_valid_block_height
  ) {
    await setAttemptStatus(
      attempt.signature,
      "FAILED",
      "Incomplete recovery journal",
    );
    return { recovered: false as const, failedAttempt: attempt.signature };
  }

  const lastValidBlockHeight = Number(attempt.last_valid_block_height);
  if ((await currentBlockHeight()) > lastValidBlockHeight) {
    await setAttemptStatus(
      attempt.signature,
      "EXPIRED",
      "Transaction blockhash expired before confirmation",
    );
    return { recovered: false as const, expiredAttempt: attempt.signature };
  }

  const prepared: PreparedDistribution = {
    signature: attempt.signature,
    serializedTx: attempt.serialized_tx,
    blockhash: attempt.recent_blockhash,
    lastValidBlockHeight,
  };

  await broadcastPreparedDistribution(prepared);
  await setAttemptStatus(prepared.signature, "SENT");
  await confirmPreparedDistribution(prepared);

  const confirmed = await readDistributionResult(
    prepared.signature,
    token.quote_asset,
    4,
  );
  if (!confirmed.found) {
    throw new Error("Recovered distribution confirmed but receipt is not indexed yet");
  }
  if (!confirmed.ok) {
    await setAttemptStatus(
      prepared.signature,
      "FAILED",
      confirmed.error || "On-chain transaction failed",
    );
    return { recovered: false as const, failedAttempt: prepared.signature };
  }

  await finalizeClaim(token, prepared.signature, confirmed.amountBaseUnits);
  return {
    recovered: true as const,
    signature: prepared.signature,
    amountBaseUnits: confirmed.amountBaseUnits,
  };
}

async function processToken(token: TokenRow) {
  const verified = await verifyDirectCreatorRouting(token.mint);
  if (!verified.ok) throw new Error(verified.reason);

  const recovery = await recoverOpenAttempt(token);
  if (recovery.recovered) {
    return {
      signature: recovery.signature,
      amountBaseUnits: recovery.amountBaseUnits,
      recovered: true,
    };
  }

  const prepared = await prepareCreatorFeeDistribution(
    token.mint,
    token.quote_asset,
  );
  if (!prepared) {
    return {
      signature: null,
      amountBaseUnits: 0n,
      recovered: false,
    };
  }

  await query(
    `insert into claims(
       token_id,
       signature,
       asset,
       amount_base_units,
       status,
       serialized_tx,
       recent_blockhash,
       last_valid_block_height
     ) values($1,$2,$3,null,'PREPARED',$4,$5,$6)
     on conflict(signature) do nothing`,
    [
      token.id,
      prepared.signature,
      token.quote_asset,
      prepared.serializedTx,
      prepared.blockhash,
      prepared.lastValidBlockHeight,
    ],
  );

  await broadcastPreparedDistribution(prepared);
  await setAttemptStatus(prepared.signature, "SENT");
  await confirmPreparedDistribution(prepared);

  const confirmed = await readDistributionResult(
    prepared.signature,
    token.quote_asset,
    4,
  );
  if (!confirmed.found) {
    throw new Error("Distribution confirmed but receipt is not indexed yet");
  }
  if (!confirmed.ok) {
    await setAttemptStatus(
      prepared.signature,
      "FAILED",
      confirmed.error || "On-chain transaction failed",
    );
    throw new Error("Distribution transaction failed on-chain");
  }

  await finalizeClaim(token, prepared.signature, confirmed.amountBaseUnits);
  return {
    signature: prepared.signature,
    amountBaseUnits: confirmed.amountBaseUnits,
    recovered: false,
  };
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tokens = await query<TokenRow>(
    `select id::text,mint,quote_asset
     from tokens
     where fee_status = 'LOCKED'
     order by locked_at asc
     limit 50`,
  );

  const results: Array<Record<string, unknown>> = [];

  for (const token of tokens.rows) {
    const lockClient = await db().connect();
    let locked = false;
    try {
      const lock = await lockClient.query<{ locked: boolean }>(
        "select pg_try_advisory_lock(hashtext('GOFUND_CLAIM'), hashtext($1)) as locked",
        [token.id],
      );
      locked = Boolean(lock.rows[0]?.locked);

      if (!locked) {
        results.push({ mint: token.mint, ok: true, skipped: "already processing" });
        continue;
      }

      const distributed = await processToken(token);
      results.push({
        mint: token.mint,
        ok: true,
        signature: distributed.signature,
        amountBaseUnits: distributed.amountBaseUnits.toString(),
        recovered: distributed.recovered,
      });
    } catch (e) {
      results.push({
        mint: token.mint,
        ok: false,
        error: e instanceof Error ? e.message : "distribution failed",
      });
    } finally {
      if (locked) {
        await lockClient.query(
          "select pg_advisory_unlock(hashtext('GOFUND_CLAIM'), hashtext($1))",
          [token.id],
        ).catch(() => undefined);
      }
      lockClient.release();
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
