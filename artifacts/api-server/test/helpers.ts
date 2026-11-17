import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { sql, eq } from "drizzle-orm";
import supertest from "supertest";
import type { Express } from "express";
import { runMigrations, users, organizationMembers, organizations, type Database } from "@workspace/db";
import type { Role } from "@workspace/domain";
import { loadConfig } from "../src/config/env";
import { createContext, type AppContext, type ContextOverrides } from "../src/context";
import { createApp } from "../src/app";
import { hashPassword } from "../src/lib/crypto";
import { LogTransport } from "../src/services/email";
import { createLogger } from "../src/lib/logger";
import { seed } from "../src/scripts/seed";
import { payfastSignature } from "../src/services/payments/payfast";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://operandis:operandis@localhost:5432/operandis_test";
export const PASSWORD = "correct-horse-42";

export const PAYFAST = { id: "10000100", key: "46f0cd694581a", passphrase: "jt7NOE43FZPn" };

export function testConfig(extra: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DB,
    APP_SECRET: "test-secret-for-automated-tests-only-0123456789",
    RATE_LIMIT_DISABLED: "true",
    LOG_LEVEL: "silent",
    PUBLIC_WEB_URL: "http://web.test",
    PUBLIC_API_URL: "http://api.test",
    STORAGE_LOCAL_DIR: path.join(os.tmpdir(), `operandis-test-files-${process.pid}`),
    PAYFAST_MODE: "sandbox",
    PAYFAST_MERCHANT_ID: PAYFAST.id,
    PAYFAST_MERCHANT_KEY: PAYFAST.key,
    PAYFAST_PASSPHRASE: PAYFAST.passphrase,
    PAYFAST_SKIP_REMOTE_VALIDATION: "true",
    YOCO_SECRET_KEY: "sk_test_dummy",
    YOCO_WEBHOOK_SECRET: `whsec_${Buffer.from("yoco-test-webhook-secret").toString("base64")}`,
    ...extra,
  });
}

export interface TestEnv {
  app: AppContext;
  server: Express;
  db: Database;
  outbox: LogTransport["outbox"];
  close: () => Promise<void>;
}

/** Fresh schema + migrations + demo seed. Test files run sequentially against one database. */
export async function setupTestEnv(overrides: ContextOverrides = {}, extraEnv: Record<string, string> = {}): Promise<TestEnv> {
  const config = testConfig(extraEnv);
  const email = new LogTransport(createLogger("silent"));
  const app = createContext(config, { email, logger: createLogger("silent"), ...overrides });
  await app.db.execute(sql`drop schema if exists public cascade`);
  await app.db.execute(sql`drop schema if exists drizzle cascade`);
  await app.db.execute(sql`create schema public`);
  await runMigrations(app.db, path.resolve(import.meta.dirname, "../../../lib/db/migrations"));
  await seed(app, { demo: true });
  app.settings.invalidate();
  const server = createApp(app);
  return { app, server, db: app.db, outbox: email.outbox, close: async () => {
      await app.notifications.idle();
      await app.dbHandle.close();
    } };
}

/** A cookie-carrying client that handles the CSRF double-submit automatically. */
export async function client(server: Express) {
  const agent = supertest.agent(server);
  const res = await agent.get("/api/v1/auth/csrf");
  const token = res.body.token as string;
  const withCsrf = <T extends supertest.Test>(t: T) => t.set("x-csrf-token", token);
  return {
    agent,
    csrf: token,
    get: (p: string) => agent.get(`/api/v1${p}`),
    post: (p: string, body?: unknown) => withCsrf(agent.post(`/api/v1${p}`)).send(body ?? {}),
    patch: (p: string, body?: unknown) => withCsrf(agent.patch(`/api/v1${p}`)).send(body ?? {}),
    put: (p: string, body?: unknown) => withCsrf(agent.put(`/api/v1${p}`)).send(body ?? {}),
    del: (p: string) => withCsrf(agent.delete(`/api/v1${p}`)),
    upload: (p: string, fields: Record<string, string>, file: { name: string; data: Buffer }) => {
      let t = withCsrf(agent.post(`/api/v1${p}`));
      for (const [k, v] of Object.entries(fields)) t = t.field(k, v);
      return t.attach("file", file.data, file.name);
    },
  };
}
export type Client = Awaited<ReturnType<typeof client>>;

let userCounter = 0;
/** Create a user directly (verified by default) with an organisation, then sign in. */
export async function createUser(env: TestEnv, opts: { role?: Role; email?: string; name?: string; verified?: boolean; company?: string } = {}) {
  userCounter++;
  const email = opts.email ?? `user${userCounter}-${crypto.randomUUID().slice(0, 6)}@example.co.za`;
  const [u] = await env.db
    .insert(users)
    .values({
      email,
      emailNormalized: email.toLowerCase(),
      name: opts.name ?? `Test User ${userCounter}`,
      role: opts.role ?? "client",
      passwordHash: await hashPassword(PASSWORD, { fast: true }),
      emailVerifiedAt: opts.verified === false ? null : new Date(),
    })
    .returning();
  const [org] = await env.db.insert(organizations).values({ name: opts.company ?? `${u.name} Ltd`, kind: "company", billingEmail: email }).returning();
  await env.db.insert(organizationMembers).values({ organizationId: org.id, userId: u.id, role: "owner" });
  const c = await client(env.server);
  const login = await c.post("/auth/login", { email, password: PASSWORD });
  if (login.status !== 200) throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`);
  return { user: u, org, c };
}

export async function verifyUserEmail(env: TestEnv, userId: string) {
  await env.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
}

/** Build a PayFast ITN body exactly as PayFast posts it (ordered, signed). */
export function payfastItn(fields: { m_payment_id: string; pf_payment_id: string; payment_status: "COMPLETE" | "FAILED" | "CANCELLED" | "PENDING"; amount_gross: string; item_name?: string }, opts: { tamper?: boolean } = {}) {
  const fee = (-(Number(fields.amount_gross) * 0.035)).toFixed(2);
  const net = (Number(fields.amount_gross) + Number(fee)).toFixed(2);
  const pairs: [string, string][] = [
    ["m_payment_id", fields.m_payment_id],
    ["pf_payment_id", fields.pf_payment_id],
    ["payment_status", fields.payment_status],
    ["item_name", fields.item_name ?? "Test item"],
    ["item_description", ""],
    ["amount_gross", fields.amount_gross],
    ["amount_fee", fee],
    ["amount_net", net],
    ["custom_str1", ""],
    ["name_first", "Thandi"],
    ["name_last", "Mokoena"],
    ["email_address", "buyer@example.co.za"],
    ["merchant_id", PAYFAST.id],
  ];
  const enc = (v: string) => encodeURIComponent(v).replace(/%20/g, "+");
  // ITN signatures include empty fields.
  let str = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v.trim()).replace(/%20/g, "+")}`).join("&");
  str += `&passphrase=${encodeURIComponent(PAYFAST.passphrase).replace(/%20/g, "+")}`;
  let signature = crypto.createHash("md5").update(str).digest("hex");
  if (opts.tamper) signature = signature.replace(/^./, (c) => (c === "a" ? "b" : "a"));
  return [...pairs.map(([k, v]) => `${k}=${enc(v)}`), `signature=${signature}`].join("&");
}

export async function postItn(env: TestEnv, body: string) {
  return supertest(env.server).post("/api/v1/webhooks/payments/payfast").set("content-type", "application/x-www-form-urlencoded").send(body);
}

export { payfastSignature };

export const sampleAnswers = (overrides: Record<string, unknown> = {}) => ({
  context: { clientType: "company", name: "Thandi Mokoena", email: "thandi@acme.co.za", company: "Acme Logistics", industry: "Logistics", country: "ZA", phone: "", role: "" },
  problem: { description: "We run dispatch from three spreadsheets and a WhatsApp group; orders get lost and invoices go out late every week." },
  solution: { types: ["internal_system"] },
  users: { internalBand: "11_50", customerBand: "none", roleBand: "two_three" },
  capabilities: { features: ["user_accounts", "roles_permissions", "reporting"] },
  integrations: { items: [{ key: "accounting", vendor: "Xero", apiAvailable: "yes" }] },
  platforms: { platforms: ["web", "mobile_web"], branding: "partial" },
  migration: { level: "light", sourceOwnershipKnown: true, contentReady: "partial", hasDomainHosting: true },
  budget: { budgetBand: "150k_400k", launchTarget: "3_6_months", urgency: "standard" },
  review: { contactPreference: "email", consentProcessing: true, consentMarketing: false },
  ...overrides,
});

export const idem = () => `test-${crypto.randomUUID()}`;
