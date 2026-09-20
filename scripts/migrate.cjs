const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");

  const sql = fs.readFileSync(
    path.join(process.cwd(), "db", "schema.sql"),
    "utf8",
  );

  const client = new Client({
    connectionString,
    ssl: connectionString.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    process.stdout.write("GoFund schema migration complete\n");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write((error && error.stack) || String(error));
  process.stderr.write("\n");
  process.exit(1);
});
