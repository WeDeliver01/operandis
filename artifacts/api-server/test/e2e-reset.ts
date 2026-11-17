/**
 * E2E fixture (test-only, never bundled): reset the E2E database, apply migrations,
 * load demo seed data and create known staff accounts.
 */
import path from "node:path";
import { sql } from "drizzle-orm";
import { runMigrations, users, organizations, organizationMembers } from "@workspace/db";
import { loadConfig } from "../src/config/env";
import { createContext } from "../src/context";
import { seed } from "../src/scripts/seed";
import { hashPassword } from "../src/lib/crypto";

const config = loadConfig();
if (config.isProd || !/e2e/.test(config.DATABASE_URL)) throw new Error("refusing to reset a non-e2e database");
const app = createContext(config);
await app.db.execute(sql`drop schema if exists public cascade`);
await app.db.execute(sql`drop schema if exists drizzle cascade`);
await app.db.execute(sql`create schema public`);
await runMigrations(app.db, path.resolve(import.meta.dirname, "../../../lib/db/migrations"));
await seed(app, { demo: true });
const passwordHash = await hashPassword("e2e-password-123", { fast: true });
const [org] = await app.db.insert(organizations).values({ name: "Operandis", kind: "company" }).returning();
for (const [email, role] of [["owner@e2e.test", "owner"], ["finance@e2e.test", "finance"]] as const) {
  const [u] = await app.db.insert(users).values({ email, emailNormalized: email, name: role === "owner" ? "Olivia Owner" : "Fiona Finance", role, passwordHash, emailVerifiedAt: new Date() }).returning();
  await app.db.insert(organizationMembers).values({ organizationId: org.id, userId: u.id });
}
await app.dbHandle.close();
console.log("e2e database ready");
