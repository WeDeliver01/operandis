import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./index";

/** Default migrations folder, resolved relative to this package (overridable for bundled deploys). */
export function defaultMigrationsFolder(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "migrations");
}

export async function runMigrations(db: Database, migrationsFolder = defaultMigrationsFolder()): Promise<void> {
  await migrate(db, { migrationsFolder });
}
