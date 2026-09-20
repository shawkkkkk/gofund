import {
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PUMP_SDK } from "@pump-fun/pump-sdk";

const user = Keypair.generate();
const mint = Keypair.generate();
const treasury = Keypair.generate().publicKey;

const createIx = await PUMP_SDK.createV2Instruction({
  mint: mint.publicKey,
  name: "X".repeat(32),
  symbol: "Y".repeat(10),
  uri: "https://example.com/" + "m".repeat(96),
  creator: user.publicKey,
  user: user.publicKey,
  mayhemMode: false,
  holderReward: false,
});

const shareIx = await PUMP_SDK.createFeeSharingConfig({
  creator: user.publicKey,
  mint: mint.publicKey,
  pool: null,
});

const lockIx = await PUMP_SDK.updateFeeSharesV2({
  authority: user.publicKey,
  mint: mint.publicKey,
  currentShareholders: [user.publicKey],
  newShareholders: [{ address: treasury, shareBps: 10_000 }],
  quoteMint: NATIVE_MINT,
  quoteTokenProgram: TOKEN_PROGRAM_ID,
});

const message = new TransactionMessage({
  payerKey: user.publicKey,
  recentBlockhash: "11111111111111111111111111111111",
  instructions: [createIx, shareIx, lockIx],
}).compileToV0Message();

const tx = new VersionedTransaction(message);
tx.sign([user, mint]);
const bytes = tx.serialize().length;

console.log("Atomic launch packet bytes:", bytes);
if (bytes > 1232) {
  throw new Error(`Atomic launch exceeds Solana packet limit: ${bytes} > 1232`);
}
