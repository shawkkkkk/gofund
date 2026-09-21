import { Pool, type QueryResultRow } from "pg";

declare global {
  var __gofundPool: Pool | undefined;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  return new Pool({
    connectionString,
    max: 5,
    ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: true },
  });
}

export function db() {
  if (!globalThis.__gofundPool) globalThis.__gofundPool = createPool();
  return globalThis.__gofundPool;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return db().query<T>(text, values);
}

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}
