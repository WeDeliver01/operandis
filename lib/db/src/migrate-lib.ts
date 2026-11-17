import { migrate } from "drizzle-orm/node-postgres/migrator";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./index";

/** Default migrations folder, resolved relative to this package (overridable for bundled deploys). */
export function defaultMigrationsFolder(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Bundled server: dist/migrations next to the bundle. Source: lib/db/migrations.
  const candidates = [path.resolve(here, "migrations"), path.resolve(here, "..", "migrations")];
  return candidates.find((c) => fs.existsSync(path.join(c, "meta", "_journal.json"))) ?? candidates[1];
}

export async function runMigrations(db: Database, migrationsFolder = defaultMigrationsFolder()): Promise<void> {
  await migrate(db, { migrationsFolder });
}
