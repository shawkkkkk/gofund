import { Connection, PublicKey } from "@solana/web3.js";
import {
  PUMP_SDK,
  bondingCurvePda,
} from "@pump-fun/pump-sdk";
import { canonicalPumpPoolPda } from "@pump-fun/pump-swap-sdk";
import { db, query } from "@/lib/db";
import { rpcUrl, treasuryAddress, USDC_MINT } from "@/lib/config";

type Venue = "PUMP" | "PUMP_SWAP";

export type IndexableToken = {
  id: string;
  mint: string;
  quote_asset: "SOL" | "USDC";
  launch_signature: string;
};

type SignatureRow = {
  signature: string;
  slot: number;
  err: unknown;
};

const MAX_PAGES_PER_RUN = 100;
const PAGE_SIZE = 1000;
const TX_BATCH_SIZE = 50;

function connection() {
  return new Connection(rpcUrl(), "confirmed");
}

function publicKey(value: unknown): PublicKey | null {
  if (value instanceof PublicKey) return value;
  if (typeof value === "string") {
    try { return new PublicKey(value); } catch { return null; }
  }
  return null;
}

function bigIntValue(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string") return BigInt(value);
  if (value && typeof value === "object" && "toString" in value) {
    return BigInt(String((value as { toString(): string }).toString()));
  }
  return 0n;
}

function field(record: Record<string, unknown>, camel: string, snake: string) {
  return record[camel] ?? record[snake];
}

async function cursorFor(token: IndexableToken, venue: Venue) {
  const result = await query<{ cursor_signature: string | null }>(
    `select cursor_signature
     from index_cursors
     where token_id=$1 and venue=$2`,
    [token.id, venue],
  );
  if (result.rowCount) return result.rows[0].cursor_signature;

  // The bonding curve exists at launch, so the create signature is the safe
  // lower bound. PumpSwap has no activity before its pool exists.
  const initial = venue === "PUMP" ? token.launch_signature : null;
  await query(
    `insert into index_cursors(token_id,venue,cursor_signature)
     values($1,$2,$3)
     on conflict(token_id,venue) do nothing`,
    [token.id, venue, initial],
  );
  return initial;
}

async function fetchSince(
  conn: Connection,
  address: PublicKey,
  until: string | null,
) {
  const all: SignatureRow[] = [];
  let before: string | undefined;

  for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
    const rows = await conn.getSignaturesForAddress(
      address,
      {
        limit: PAGE_SIZE,
        ...(before ? { before } : {}),
        ...(until ? { until } : {}),
      },
      "confirmed",
    );

    if (!rows.length) break;
    all.push(...rows.map((row) => ({
      signature: row.signature,
      slot: row.slot,
      err: row.err,
    })));

    if (rows.length < PAGE_SIZE) break;
    before = rows[rows.length - 1].signature;

    if (page === MAX_PAGES_PER_RUN - 1) {
      throw new Error(
        "Indexer backlog exceeded 100,000 signatures; cursor was left unchanged",
      );
    }
  }

  return all;
}

function decodePumpTrade(data: Buffer) {
  return PUMP_SDK.decodeTradeEventBc(data);
}

function decodeAmmTrade(data: Buffer) {
  try {
    return {
      type: "buy" as const,
      data: PUMP_SDK.decodeBuyEventAmm(data),
    };
  } catch {
    try {
      return {
        type: "sell" as const,
        data: PUMP_SDK.decodeSellEventAmm(data),
      };
    } catch {
      return null;
    }
  }
}

async function insertFeeEvent(args: {
  tokenId: string;
  venue: Venue;
  signature: string;
  eventIndex: number;
  slot: number;
  asset: "SOL" | "USDC";
  amount: bigint;
  blockTime: number | null | undefined;
}) {
  if (args.amount <= 0n) return false;
  const result = await query(
    `insert into fee_events(
       token_id,venue,signature,event_index,slot,asset,amount_base_units,block_time
     ) values(
       $1,$2,$3,$4,$5,$6,$7,
       case when $8::bigint is null then null else to_timestamp($8::bigint) end
     )
     on conflict(signature,venue,event_index) do nothing
     returning id`,
    [
      args.tokenId,
      args.venue,
      args.signature,
      args.eventIndex,
      args.slot,
      args.asset,
      args.amount.toString(),
      args.blockTime ?? null,
    ],
  );
  return Boolean(result.rowCount);
}

async function processPumpTransaction(
  token: IndexableToken,
  signature: SignatureRow,
  tx: Awaited<ReturnType<Connection["getTransaction"]>>,
  treasury: PublicKey,
) {
  if (!tx?.meta || tx.meta.err) return 0;
  let inserted = 0;

  for (const [index, log] of (tx.meta.logMessages || []).entries()) {
    const match = /^Program data: (.+)$/.exec(log);
    if (!match) continue;

    try {
      const decoded = decodePumpTrade(Buffer.from(match[1], "base64"));
      if (!decoded || typeof decoded !== "object") continue;
      const event = decoded as unknown as Record<string, unknown>;

      const mint = publicKey(field(event, "mint", "mint"));
      const creator = publicKey(field(event, "creator", "creator"));
      if (!mint?.equals(new PublicKey(token.mint))) continue;
      if (!creator?.equals(treasury)) continue;

      const amount = bigIntValue(
        field(event, "creatorFee", "creator_fee"),
      );
      if (await insertFeeEvent({
        tokenId: token.id,
        venue: "PUMP",
        signature: signature.signature,
        eventIndex: index,
        slot: signature.slot,
        asset: token.quote_asset,
        amount,
        blockTime: tx.blockTime,
      })) inserted += 1;
    } catch {
      // Ignore non-TradeEvent Anchor payloads.
    }
  }

  return inserted;
}

async function processAmmTransaction(
  token: IndexableToken,
  signature: SignatureRow,
  tx: Awaited<ReturnType<Connection["getTransaction"]>>,
  treasury: PublicKey,
  expectedPool: PublicKey,
) {
  if (!tx?.meta || tx.meta.err) return 0;
  let inserted = 0;

  for (const [index, log] of (tx.meta.logMessages || []).entries()) {
    const match = /^Program data: (.+)$/.exec(log);
    if (!match) continue;

    try {
      const decoded = decodeAmmTrade(Buffer.from(match[1], "base64"));
      if (!decoded) continue;

      const event = decoded.data as unknown as Record<string, unknown>;
      const pool = publicKey(field(event, "pool", "pool"));
      const creator = publicKey(
        field(event, "coinCreator", "coin_creator"),
      );
      if (!pool?.equals(expectedPool)) continue;
      if (!creator?.equals(treasury)) continue;

      const amount = bigIntValue(
        field(event, "coinCreatorFee", "coin_creator_fee"),
      );
      if (await insertFeeEvent({
        tokenId: token.id,
        venue: "PUMP_SWAP",
        signature: signature.signature,
        eventIndex: index,
        slot: signature.slot,
        asset: token.quote_asset,
        amount,
        blockTime: tx.blockTime,
      })) inserted += 1;
    } catch {
      // Ignore events emitted by other programs in the same transaction.
    }
  }

  return inserted;
}

async function indexVenue(token: IndexableToken, venue: Venue) {
  const conn = connection();
  const mint = new PublicKey(token.mint);
  const treasury = new PublicKey(treasuryAddress());
  const address =
    venue === "PUMP"
      ? bondingCurvePda(mint)
      : token.quote_asset === "USDC"
        ? canonicalPumpPoolPda(mint, new PublicKey(USDC_MINT))
        : canonicalPumpPoolPda(mint);

  if (venue === "PUMP_SWAP") {
    const exists = await conn.getAccountInfo(address, "confirmed");
    if (!exists) return { venue, signatures: 0, events: 0, poolExists: false };
  }

  const cursor = await cursorFor(token, venue);
  const signatures = await fetchSince(conn, address, cursor);
  if (!signatures.length) {
    return { venue, signatures: 0, events: 0, poolExists: true };
  }

  let events = 0;
  const ordered = [...signatures].reverse();

  for (let i = 0; i < ordered.length; i += TX_BATCH_SIZE) {
    const batch = ordered.slice(i, i + TX_BATCH_SIZE);
    const txs = await conn.getTransactions(
      batch.map((row) => row.signature),
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    );

    for (let j = 0; j < batch.length; j += 1) {
      const sig = batch[j];
      if (sig.err) continue;
      const tx = txs[j];
      if (!tx) {
        throw new Error(
          `RPC did not return confirmed transaction ${sig.signature}`,
        );
      }
      events +=
        venue === "PUMP"
          ? await processPumpTransaction(token, sig, tx, treasury)
          : await processAmmTransaction(token, sig, tx, treasury, address);
    }
  }

  const newest = signatures[0].signature;
  await query(
    `insert into index_cursors(token_id,venue,cursor_signature,updated_at)
     values($1,$2,$3,now())
     on conflict(token_id,venue)
     do update set cursor_signature=excluded.cursor_signature,updated_at=now()`,
    [token.id, venue, newest],
  );

  return {
    venue,
    signatures: signatures.length,
    events,
    poolExists: true,
    cursor: newest,
  };
}

export async function indexTokenFees(token: IndexableToken) {
  const client = await db().connect();
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtext('GOFUND_INDEX'), hashtext($1)) as locked",
      [token.id],
    );
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) return { skipped: "already indexing" as const };

    const pump = await indexVenue(token, "PUMP");
    const pumpSwap = await indexVenue(token, "PUMP_SWAP");
    return { pump, pumpSwap };
  } finally {
    if (locked) {
      await client.query(
        "select pg_advisory_unlock(hashtext('GOFUND_INDEX'), hashtext($1))",
        [token.id],
      ).catch(() => undefined);
    }
    client.release();
  }
}
