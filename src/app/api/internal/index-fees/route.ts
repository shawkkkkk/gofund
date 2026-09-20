import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { indexTokenFees, type IndexableToken } from "@/lib/fee-indexer";
import { verifyDirectCreatorRouting } from "@/lib/pump-server";

function authorized(request: Request) {
  const expected = process.env.INTERNAL_API_SECRET;
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied === expected);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tokens = await query<IndexableToken>(
    `select id::text,mint,quote_asset,launch_signature
     from tokens
     where fee_status='LOCKED'
       and launch_signature is not null
     order by locked_at asc
     limit 50`,
  );

  const results: Array<Record<string, unknown>> = [];

  for (const token of tokens.rows) {
    try {
      const routing = await verifyDirectCreatorRouting(token.mint);
      if (!routing.ok) {
        await query(
          `update tokens
           set fee_status='INVALID'
           where id=$1 and fee_status='LOCKED'`,
          [token.id],
        );
        results.push({
          mint: token.mint,
          ok: false,
          invalidated: true,
          error: routing.reason,
        });
        continue;
      }

      const indexed = await indexTokenFees(token);
      results.push({ mint: token.mint, ok: true, ...indexed });
    } catch (e) {
      results.push({
        mint: token.mint,
        ok: false,
        error: e instanceof Error ? e.message : "indexing failed",
      });
    }
  }

  return NextResponse.json({
    processed: results.length,
    results,
  });
}
