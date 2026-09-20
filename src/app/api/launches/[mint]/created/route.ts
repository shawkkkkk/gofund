import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { verifyLaunchTransaction } from "@/lib/pump-server";

const schema = z.object({ signature: z.string().min(20) });

type DraftRow = {
  launcher_wallet: string;
  name: string;
  symbol: string;
  metadata_uri: string;
  quote_asset: "SOL" | "USDC";
  fee_status: "DRAFT" | "CREATED" | "LOCKED" | "INVALID";
  launch_signature: string | null;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ mint: string }> },
) {
  try {
    const { mint } = await params;
    const { signature } = schema.parse(await request.json());

    const draft = await query<DraftRow>(
      `select launcher_wallet,name,symbol,metadata_uri,quote_asset,fee_status,launch_signature
       from tokens
       where mint = $1`,
      [mint],
    );
    if (!draft.rowCount) throw new Error("Launch draft not found");

    const token = draft.rows[0];
    if (token.launch_signature && token.launch_signature !== signature) {
      return NextResponse.json(
        { error: "A different launch signature is already bound to this mint" },
        { status: 409 },
      );
    }

    const verified = await verifyLaunchTransaction({
      signature,
      mint,
      launcherWallet: token.launcher_wallet,
      name: token.name,
      symbol: token.symbol,
      metadataUri: token.metadata_uri,
      quoteAsset: token.quote_asset,
    });

    if (!verified.ok) {
      return NextResponse.json(
        { error: verified.reason },
        { status: 409 },
      );
    }

    const result = await query<{ fee_status: string }>(
      `update tokens
       set launch_signature = coalesce(launch_signature, $1),
           fee_status = case when fee_status = 'DRAFT' then 'CREATED' else fee_status end
       where mint = $2
         and fee_status in ('DRAFT','CREATED','LOCKED')
       returning fee_status`,
      [signature, mint],
    );

    if (!result.rowCount) throw new Error("Launch record is not registrable");

    await query(
      `insert into audit_log(event_type,subject_type,subject_id,payload)
       values('LAUNCH_VERIFIED','TOKEN',$1,$2::jsonb)`,
      [mint, JSON.stringify({ signature })],
    );

    return NextResponse.json({ ok: true, feeStatus: result.rows[0].fee_status });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 400 },
    );
  }
}
