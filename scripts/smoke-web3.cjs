const assert = require("node:assert/strict");
const { Connection } = require("@solana/web3.js");

async function main() {
  let requestBody = null;
  const connection = new Connection("http://127.0.0.1:8899", {
    commitment: "confirmed",
    fetch: async (_url, init) => {
      requestBody = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: requestBody.id,
          result: 123456789,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  const height = await connection.getBlockHeight("confirmed");
  assert.equal(height, 123456789);
  assert.equal(requestBody.method, "getBlockHeight");
  assert.ok(Array.isArray(requestBody.params));
  process.stdout.write("web3 RPC smoke test passed\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
