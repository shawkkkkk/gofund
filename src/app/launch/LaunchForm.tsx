"use client";

import { FormEvent, useState } from "react";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { PUMP_SDK } from "@pump-fun/pump-sdk";
import { USDC_MINT } from "@/lib/config";

type Preview = {
  canonicalUrl: string;
  slug: string;
};

type WalletProvider = {
  publicKey?: PublicKey;
  connect(): Promise<{ publicKey: PublicKey }>;
  signTransaction<T extends VersionedTransaction>(tx: T): Promise<T>;
};

declare global {
  interface Window { solana?: WalletProvider }
}

const treasury = process.env.NEXT_PUBLIC_GOFUND_TREASURY || "";

export default function LaunchForm() {
  const [campaignUrl, setCampaignUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [campaignTitle, setCampaignTitle] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [quote, setQuote] = useState<"SOL" | "USDC">("USDC");
  const [wallet, setWallet] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [eligibilityConfirmed, setEligibilityConfirmed] = useState(false);

  async function connect() {
    setError("");
    if (!window.solana) {
      throw new Error("No compatible Solana browser wallet found");
    }
    const result = await window.solana.connect();
    setWallet(result.publicKey.toBase58());
    return result.publicKey;
  }

  async function validateCampaign() {
    setError("");
    setPreview(null);
    try {
      const res = await fetch("/api/campaigns/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: campaignUrl }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Could not validate campaign URL");
      }
      setPreview(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not validate campaign URL");
    }
  }

  async function send(
    provider: WalletProvider,
    user: PublicKey,
    instructions: TransactionInstruction[],
    extraSigners: Keypair[] = [],
  ) {
    const conn = new Connection(window.location.origin + "/api/rpc", "confirmed");
    const { blockhash, lastValidBlockHeight } =
      await conn.getLatestBlockhash("confirmed");

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

    await conn.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );

    return signature;
  }

  async function registerConfirmedLaunch(mint: string, signature: string) {
    const res = await fetch("/api/launches/" + mint + "/created", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(
        body.error ||
          "Token was created, but GoFund could not verify its fee routing",
      );
    }
    return body as { ok: true; feeStatus: string; creator: string };
  }

  async function launch(e: FormEvent) {
    e.preventDefault();
    setError("");
    setStatus([]);

    if (!preview) return setError("Validate the campaign URL first");
    if (!campaignTitle.trim()) {
      return setError("Enter a fundraiser display label");
    }
    if (!treasury) {
      return setError("GoFund treasury is not configured yet");
    }
    if (!eligibilityConfirmed) {
      return setError("Confirm eligibility and the GoFund disclosures before launching");
    }

    setBusy(true);
    try {
      const provider = window.solana;
      if (!provider) {
        throw new Error("No compatible Solana browser wallet found");
      }

      const user = provider.publicKey || (await connect());
      const mint = Keypair.generate();
      const treasuryKey = new PublicKey(treasury);

      setStatus([
        "Wallet connected",
        "Mint generated: " + mint.publicKey.toBase58(),
        "Creator-fee recipient: GoFund treasury",
      ]);

      const draftRes = await fetch("/api/launches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          campaignUrl: preview.canonicalUrl,
          campaignTitle,
          name,
          symbol,
          description,
          imageUrl: imageUrl || null,
          quoteAsset: quote,
          launcherWallet: user.toBase58(),
          mint: mint.publicKey.toBase58(),
          eligibilityConfirmed: true,
        }),
      });
      const draft = await draftRes.json();
      if (!draftRes.ok) {
        throw new Error(draft.error || "Could not create launch draft");
      }

      const createIx = await PUMP_SDK.createV2Instruction({
        mint: mint.publicKey,
        name,
        symbol: symbol.toUpperCase(),
        uri: draft.metadataUri,
        creator: treasuryKey,
        user,
        mayhemMode: false,
        holderReward: false,
        ...(quote === "USDC"
          ? { quoteMint: new PublicKey(USDC_MINT) }
          : {}),
      });

      const launchSig = await send(provider, user, [createIx], [mint]);
      setStatus((s) => [
        ...s,
        "Token created: " + launchSig.slice(0, 8) + "…",
        "Verifying creator-fee destination on-chain…",
      ]);

      const verified = await registerConfirmedLaunch(
        mint.publicKey.toBase58(),
        launchSig,
      );

      setStatus((s) => [
        ...s,
        "✓ GoFund verified creator fees route directly to " +
          verified.creator.slice(0, 6) +
          "…" +
          verified.creator.slice(-6),
        "✓ Launch active",
      ]);
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
          <input
            placeholder="https://www.gofundme.com/f/..."
            value={campaignUrl}
            onChange={(e) => setCampaignUrl(e.target.value)}
          />
          <button
            type="button"
            className="button small outline"
            onClick={validateCampaign}
          >
            Use link
          </button>
        </div>
      </div>

      {preview && <div className="preview">
        <strong>Campaign URL accepted</strong>
        <p className="muted">
          GoFund stores the canonical link but does not scrape GoFundMe.
          Organizer endorsement is not implied unless separately verified.
        </p>
        <small>{preview.canonicalUrl}</small>
      </div>}

      <div className="field">
        <label>
          Fundraiser display label{" "}
          <span className="muted">(unverified until organizer claim)</span>
        </label>
        <input
          required
          maxLength={120}
          value={campaignTitle}
          onChange={(e) => setCampaignTitle(e.target.value)}
          placeholder="Help Maya Fight Leukemia"
        />
      </div>

      <div className="inline">
        <div className="field">
          <label>2. Token name</label>
          <input
            required
            maxLength={32}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Maya Strong"
          />
        </div>
        <div className="field">
          <label>Ticker</label>
          <input
            required
            maxLength={10}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="MAYA"
          />
        </div>
      </div>

      <div className="field">
        <label>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Why this coin exists"
        />
      </div>

      <div className="field">
        <label>Image URL</label>
        <input
          type="url"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://..."
        />
      </div>

      <div className="field">
        <label>Pair</label>
        <select
          value={quote}
          onChange={(e) => setQuote(e.target.value as "SOL" | "USDC")}
        >
          <option value="USDC">USDC — recommended for fundraising</option>
          <option value="SOL">SOL</option>
        </select>
      </div>

      <div className="field">
        <label style={{display:"flex",gap:10,alignItems:"flex-start",fontWeight:600}}>
          <input
            type="checkbox"
            checked={eligibilityConfirmed}
            onChange={(e) => setEligibilityConfirmed(e.target.checked)}
            style={{width:18,height:18,marginTop:2,flex:"0 0 auto"}}
          />
          <span>
            I confirm I am legally eligible to use Pump services, including being
            of the legal age of majority in my jurisdiction, and I have read
            GoFund&apos;s <a href="/terms" target="_blank">Terms</a> and{" "}
            <a href="/disclosures" target="_blank">Disclosures</a>.
          </span>
        </label>
      </div>

      {!wallet ? (
        <button
          type="button"
          className="button outline"
          onClick={() => connect().catch((e) => setError(e.message))}
        >
          Connect wallet
        </button>
      ) : (
        <div className="status ok">
          Connected: {wallet.slice(0, 5)}…{wallet.slice(-5)}
        </div>
      )}

      <button
        disabled={busy || !preview || !eligibilityConfirmed}
        className="button green"
        style={{ width: "100%", marginTop: 12 }}
      >
        {busy ? "Launching…" : "Launch & route fees"}
      </button>

      {error && (
        <div className="status err" style={{ marginTop: 14 }}>{error}</div>
      )}
      {!!status.length && (
        <div className="status-list">
          {status.map((s, i) => (
            <div className="status ok" key={i}>{s}</div>
          ))}
        </div>
      )}
    </form>

    <aside className="panel">
      <div className="kicker">Before you sign</div>
      <h3 style={{ fontSize: 28, marginTop: 10 }}>
        The launcher never receives creator fees.
      </h3>
      <p className="muted">
        The Pump create transaction names GoFund&apos;s treasury as the creator-fee
        recipient from genesis. Your wallet pays for and launches the coin, but it
        is never the creator-fee destination.
      </p>
      <div className="steps">
        <div className="step">
          <strong>Reference</strong>
          <div className="muted">Bind the launch to one canonical fundraiser URL.</div>
        </div>
        <div className="step">
          <strong>Create</strong>
          <div className="muted">Your wallet creates the Pump coin.</div>
        </div>
        <div className="step">
          <strong>Route</strong>
          <div className="muted">GoFund treasury is the creator-fee recipient in the create instruction itself.</div>
        </div>
        <div className="step">
          <strong>Verify</strong>
          <div className="muted">The server confirms the Pump create event and bonding-curve creator on-chain before listing the token.</div>
        </div>
      </div>
    </aside>
  </div>;
}
