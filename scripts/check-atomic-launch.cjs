const {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} = require("@solana/web3.js");
const { NATIVE_MINT, TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const { PUMP_SDK } = require("@pump-fun/pump-sdk");

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const PACKET_LIMIT = 1232;

async function packetSize(label, quoteMint) {
  const user = Keypair.generate();
  const mint = Keypair.generate();
  const treasury = Keypair.generate().publicKey;

  const createIx = await PUMP_SDK.createV2Instruction({
    mint: mint.publicKey,
    name: "X".repeat(32),
    symbol: "Y".repeat(10),
    uri: "https://example.com/metadata/" + "m".repeat(96),
    creator: user.publicKey,
    user: user.publicKey,
    mayhemMode: false,
    holderReward: false,
    ...(quoteMint.equals(USDC_MINT) ? { quoteMint } : {}),
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
    quoteMint,
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

  console.log(`${label} atomic launch packet bytes: ${bytes}/${PACKET_LIMIT}`);
  if (bytes > PACKET_LIMIT) {
    throw new Error(`${label} atomic launch exceeds Solana packet limit: ${bytes} > ${PACKET_LIMIT}`);
  }
  return bytes;
}

(async () => {
  await packetSize("SOL", NATIVE_MINT);
  await packetSize("USDC", USDC_MINT);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
