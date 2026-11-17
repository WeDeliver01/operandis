import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export * from "./schema";
export { schema };
export type Database = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction — repositories accept either. */
export type DbOrTx = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export function createDb(connectionString: string, opts: { max?: number; ssl?: boolean } = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 10,
    ssl: opts.ssl ? { rejectUnauthorized: true } : undefined,
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

export { runMigrations } from "./migrate-lib";
