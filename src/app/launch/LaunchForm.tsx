"use client";

import { FormEvent, useState } from "react";
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";

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

function decimalToBaseUnits(value: string, decimals: number) {
  const trimmed = value.trim();
  if (!trimmed) return "0";
  if (!/^\d+(?:\.\d*)?$/.test(trimmed)) {
    throw new Error("First buy must be a positive decimal amount");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error("First buy has too many decimal places");
  }
  const padded = fraction.padEnd(decimals, "0");
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0")).toString();
}

function decodeBase64(value: string) {
  const raw = atob(value);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export default function LaunchForm({ available }: { available: boolean }) {
  const [campaignUrl, setCampaignUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [campaignTitle, setCampaignTitle] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [quote, setQuote] = useState<"SOL" | "USDC">("USDC");
  const [firstBuy, setFirstBuy] = useState("0");
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

  async function signAndSendBuiltLaunch(
    provider: WalletProvider,
    mint: Keypair,
    serializedTransaction: string,
    blockhash: string,
    lastValidBlockHeight: number,
  ) {
    const conn = new Connection(window.location.origin + "/api/rpc", "confirmed");
    const tx = VersionedTransaction.deserialize(decodeBase64(serializedTransaction));
    tx.sign([mint]);
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
    if (!imageFile) {
      return setError("Choose a token image");
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
      new PublicKey(treasury);
      const firstBuyBaseUnits = decimalToBaseUnits(
        firstBuy,
        quote === "SOL" ? 9 : 6,
      );

      setStatus([
        "Wallet connected",
        "Mint generated: " + mint.publicKey.toBase58(),
        "Creator-fee recipient: GoFund treasury",
      ]);

      const metadataForm = new FormData();
      metadataForm.append("file", imageFile);
      metadataForm.append("campaignUrl", preview.canonicalUrl);
      metadataForm.append("launcherWallet", user.toBase58());
      metadataForm.append("mint", mint.publicKey.toBase58());
      metadataForm.append("name", name);
      metadataForm.append("symbol", symbol.toUpperCase());
      metadataForm.append("description", description);

      setStatus((s) => [...s, "Uploading image + immutable metadata to IPFS…"]);
      const uploadRes = await fetch("/api/uploads/metadata", {
        method: "POST",
        body: metadataForm,
      });
      const upload = await uploadRes.json();
      if (!uploadRes.ok) {
        throw new Error(upload.error || "Could not upload token metadata");
      }
      setStatus((s) => [...s, "✓ Metadata pinned"]);

      const draftRes = await fetch("/api/launches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          campaignUrl: preview.canonicalUrl,
          campaignTitle,
          name,
          symbol,
          description,
          metadataUri: upload.metadataUri,
          metadataProof: upload.metadataProof,
          quoteAsset: quote,
          firstBuyBaseUnits,
          launcherWallet: user.toBase58(),
          mint: mint.publicKey.toBase58(),
          eligibilityConfirmed: true,
        }),
      });
      const draft = await draftRes.json();
      if (!draftRes.ok) {
        throw new Error(draft.error || "Could not create launch draft");
      }

      const buildRes = await fetch(
        "/api/launches/" + mint.publicKey.toBase58() + "/build",
        { method: "POST" },
      );
      const build = await buildRes.json();
      if (!buildRes.ok) {
        throw new Error(build.error || "Could not build launch transaction");
      }

      setStatus((s) => [
        ...s,
        firstBuyBaseUnits === "0"
          ? "GoFund built and fingerprinted the create transaction"
          : "GoFund built and fingerprinted create + first buy",
      ]);

      const launchSig = await signAndSendBuiltLaunch(
        provider,
        mint,
        build.serializedTransaction,
        build.blockhash,
        build.lastValidBlockHeight,
      );
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
    {!available && (
      <div className="panel" style={{gridColumn:"1/-1",borderStyle:"dashed"}}>
        <div className="kicker">Launches paused</div>
        <h3 style={{fontSize:28,marginTop:10}}>GoFund is not accepting mainnet launches yet.</h3>
        <p className="muted">
          The production launch gate stays closed until the dedicated Solana RPC,
          worker, treasury, and readiness checks are all green.
        </p>
      </div>
    )}
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
        <label>Token image</label>
        <input
          required
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={(e) => setImageFile(e.target.files?.[0] || null)}
        />
        <small className="muted">
          PNG, JPEG, GIF, or WebP · max 5 MB · pinned with the token metadata.
        </small>
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
        <label>Optional first buy ({quote})</label>
        <input
          inputMode="decimal"
          value={firstBuy}
          onChange={(e) => setFirstBuy(e.target.value)}
          placeholder="0"
        />
        <small className="muted">
          {quote === "SOL"
            ? "0–10 SOL. This is your token purchase, not a fundraiser donation."
            : "0–10,000 USDC. This is your token purchase, not a fundraiser donation."}
        </small>
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
        disabled={!available || busy || !preview || !eligibilityConfirmed}
        className="button green"
        style={{ width: "100%", marginTop: 12 }}
      >
        {!available ? "Launches paused" : busy ? "Launching…" : "Launch & route fees"}
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
