"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PUMP_SDK } from "@pump-fun/pump-sdk";
import { USDC_MINT } from "@/lib/config";

type Preview = {
  canonicalUrl: string;
  slug: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
};

type WalletProvider = {
  publicKey?: PublicKey;
  connect(): Promise<{ publicKey: PublicKey }>;
  signTransaction<T extends VersionedTransaction>(tx: T): Promise<T>;
};

declare global {
  interface Window { solana?: WalletProvider }
}

const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const treasury = process.env.NEXT_PUBLIC_GOFUND_TREASURY || "";

export default function LaunchForm() {
  const [campaignUrl, setCampaignUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [quote, setQuote] = useState<"SOL" | "USDC">("USDC");
  const [wallet, setWallet] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingMint, setPendingMint] = useState("");
  const [pendingQuote, setPendingQuote] = useState<"SOL" | "USDC">("USDC");

  useEffect(() => {
    try {
      const raw = localStorage.getItem("gofund_pending_lock");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.mint) {
        setPendingMint(parsed.mint);
        setPendingQuote(parsed.quoteAsset === "SOL" ? "SOL" : "USDC");
      }
    } catch {}
  }, []);

  async function connect() {
    setError("");
    if (!window.solana) throw new Error("No compatible Solana browser wallet found");
    const result = await window.solana.connect();
    setWallet(result.publicKey.toBase58());
    return result.publicKey;
  }

  async function previewCampaign() {
    setError("");
    setPreview(null);
    try {
      const res = await fetch("/api/campaigns/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: campaignUrl }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not preview campaign");
      setPreview(body);
      if (!description) setDescription("Creator fees support " + body.title + ".");
      if (!imageUrl && body.imageUrl) setImageUrl(body.imageUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not preview campaign");
    }
  }

  async function send(
    provider: WalletProvider,
    user: PublicKey,
    instructions: TransactionInstruction[],
    extraSigners: Keypair[] = [],
  ) {
    const conn = new Connection(rpc, "confirmed");
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({
      payerKey: user,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    if (extraSigners.length) tx.sign(extraSigners);
    const signed = await provider.signTransaction(tx);
    const signature = await conn.sendRawTransaction(signed.serialize(), {
      maxRetries: 3,
      skipPreflight: false,
    });
    await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    return signature;
  }

  async function lockFees(
    provider: WalletProvider,
    user: PublicKey,
    mint: PublicKey,
    quoteAsset: "SOL" | "USDC",
  ) {
    const shareIx = await PUMP_SDK.createFeeSharingConfig({ creator: user, mint, pool: null });
    const configSig = await send(provider, user, [shareIx]);
    setStatus((s) => [...s, "Fee-sharing config created: " + configSig.slice(0, 8) + "…"]);

    const lockIx = await PUMP_SDK.updateFeeSharesV2({
      authority: user,
      mint,
      currentShareholders: [user],
      newShareholders: [{ address: new PublicKey(treasury), shareBps: 10_000 }],
      quoteMint: quoteAsset === "USDC" ? new PublicKey(USDC_MINT) : NATIVE_MINT,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    });
    const lockSig = await send(provider, user, [lockIx]);
    setStatus((s) => [...s, "100% fee routing finalized: " + lockSig.slice(0, 8) + "…"]);

    const lockRes = await fetch("/api/launches/" + mint.toBase58() + "/locked", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature: lockSig }),
    });
    const locked = await lockRes.json();
    if (!lockRes.ok) throw new Error(locked.error || "On-chain fee verification failed");

    localStorage.removeItem("gofund_pending_lock");
    setPendingMint("");
    setStatus((s) => [...s, "✓ GoFund verified the immutable 100% fee share on-chain"]);
  }

  async function retryLock() {
    setError("");
    setBusy(true);
    try {
      const provider = window.solana;
      if (!provider) throw new Error("No compatible Solana browser wallet found");
      const user = provider.publicKey || await connect();
      await lockFees(provider, user, new PublicKey(pendingMint), pendingQuote);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fee lock failed");
    } finally {
      setBusy(false);
    }
  }

  async function launch(e: FormEvent) {
    e.preventDefault();
    setError("");
    setStatus([]);
    if (!preview) return setError("Preview and verify the campaign first");
    if (!treasury) return setError("GoFund treasury is not configured yet");

    setBusy(true);
    try {
      const provider = window.solana;
      if (!provider) throw new Error("No compatible Solana browser wallet found");
      const user = provider.publicKey || await connect();
      const mint = Keypair.generate();
      setStatus(["Wallet connected", "Mint generated: " + mint.publicKey.toBase58()]);

      const draftRes = await fetch("/api/launches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          campaignUrl: preview.canonicalUrl,
          name,
          symbol,
          description,
          imageUrl: imageUrl || preview.imageUrl,
          quoteAsset: quote,
          launcherWallet: user.toBase58(),
          mint: mint.publicKey.toBase58(),
        }),
      });
      const draft = await draftRes.json();
      if (!draftRes.ok) throw new Error(draft.error || "Could not create launch draft");
      setStatus((s) => [...s, "Token metadata registered"]);

      const createIx = await PUMP_SDK.createV2Instruction({
        mint: mint.publicKey,
        name,
        symbol: symbol.toUpperCase(),
        uri: draft.metadataUri,
        creator: user,
        user,
        mayhemMode: false,
        holderReward: false,
        ...(quote === "USDC" ? { quoteMint: new PublicKey(USDC_MINT) } : {}),
      });

      const launchSig = await send(provider, user, [createIx], [mint]);
      setStatus((s) => [...s, "Token created: " + launchSig.slice(0, 8) + "…"]);

      const createdRes = await fetch("/api/launches/" + mint.publicKey.toBase58() + "/created", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signature: launchSig }),
      });
      if (!createdRes.ok) throw new Error("Token exists, but GoFund could not record its create transaction");

      const mintText = mint.publicKey.toBase58();
      setPendingMint(mintText);
      setPendingQuote(quote);
      localStorage.setItem("gofund_pending_lock", JSON.stringify({ mint: mintText, quoteAsset: quote }));
      await lockFees(provider, user, mint.publicKey, quote);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Launch failed");
    } finally {
      setBusy(false);
    }
  }

  return <div className="form-wrap">
    <form className="panel" onSubmit={launch}>
      <div className="field">
        <label>1. GoFundMe campaign</label>
        <div className="inline">
          <input placeholder="https://www.gofundme.com/f/..." value={campaignUrl} onChange={(e) => setCampaignUrl(e.target.value)} />
          <button type="button" className="button small outline" onClick={previewCampaign}>Preview</button>
        </div>
      </div>

      {preview && <div className="preview">
        <strong>{preview.title}</strong>
        <p className="muted">{preview.description}</p>
        <small>{preview.canonicalUrl}</small>
      </div>}

      <div className="inline">
        <div className="field"><label>2. Token name</label><input required maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="Maya Strong" /></div>
        <div className="field"><label>Ticker</label><input required maxLength={10} value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="MAYA" /></div>
      </div>

      <div className="field"><label>Description</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Why this coin exists" /></div>
      <div className="field"><label>Image URL</label><input type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." /></div>
      <div className="field"><label>Pair</label><select value={quote} onChange={(e) => setQuote(e.target.value as "SOL" | "USDC")}><option value="USDC">USDC — recommended for fundraising</option><option value="SOL">SOL</option></select></div>

      {!wallet
        ? <button type="button" className="button outline" onClick={() => connect().catch((e) => setError(e.message))}>Connect wallet</button>
        : <div className="status ok">Connected: {wallet.slice(0,5)}…{wallet.slice(-5)}</div>}

      <button disabled={busy || !preview} className="button green" style={{width:"100%",marginTop:12}}>{busy ? "Launching…" : "Launch & lock fees"}</button>
      {pendingMint && <button type="button" disabled={busy} className="button outline" style={{width:"100%",marginTop:10}} onClick={retryLock}>Retry fee lock for {pendingMint.slice(0,6)}…</button>}
      {error && <div className="status err" style={{marginTop:14}}>{error}</div>}
      {!!status.length && <div className="status-list">{status.map((s,i) => <div className="status ok" key={i}>{s}</div>)}</div>}
    </form>

    <aside className="panel">
      <div className="kicker">Before you sign</div>
      <h3 style={{fontSize:28,marginTop:10}}>100% means 100%.</h3>
      <p className="muted">GoFund will only list the token as locked after Pump&apos;s on-chain sharing config is final and assigns all 10,000 basis points to the GoFund treasury.</p>
      <div className="steps">
        <div className="step"><strong>Create</strong><div className="muted">Your wallet creates the Pump coin.</div></div>
        <div className="step"><strong>Lock</strong><div className="muted">A second transaction permanently sets the creator-fee recipient.</div></div>
        <div className="step"><strong>Verify</strong><div className="muted">The server reads the chain, not your browser&apos;s claim.</div></div>
        <div className="step"><strong>Settle</strong><div className="muted">On-chain fees and completed GoFundMe donations remain separate ledger states.</div></div>
      </div>
    </aside>
  </div>;
}
