import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { eq, sql } from "drizzle-orm";
import { users } from "@workspace/db";
import { client, createUser, setupTestEnv, PASSWORD, type TestEnv } from "./helpers";
import { totp, decrypt } from "../src/lib/crypto";

let env: TestEnv;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => env.close());

const tokenFrom = (text: string, path: string) => new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`).exec(text)?.[1];

describe("authentication & sessions", () => {
  it("registers, signs in via cookie session and returns /me", async () => {
    const c = await client(env.server);
    const reg = await c.post("/auth/register", { name: "Lerato Dlamini", email: "lerato@example.co.za", password: "a-strong-pass-1" });
    expect(reg.status).toBe(201);
    const me = await c.get("/me");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: "lerato@example.co.za", role: "client", emailVerified: false });
    expect(me.body.organizations).toHaveLength(1);
    const setCookie = reg.headers["set-cookie"] as unknown as string[];
    expect(setCookie.join(";")).toMatch(/op_session=.*HttpOnly/i);
    expect(setCookie.join(";")).toMatch(/SameSite=Lax/i);
  });

  it("verifies email with a single-use token", async () => {
    const mail = env.outbox.find((m) => m.to === "lerato@example.co.za" && m.subject.startsWith("Confirm"));
    await env.app.notifications.dispatchPending();
    const msg = mail ?? env.outbox.find((m) => m.to === "lerato@example.co.za");
    const token = tokenFrom(msg!.text, "/auth/verify");
    expect(token).toBeTruthy();
    const c = await client(env.server);
    expect((await c.post("/auth/verify-email", { token })).status).toBe(200);
    expect((await c.post("/auth/verify-email", { token })).status).toBe(400); // single use
    const [u] = await env.db.select().from(users).where(eq(users.emailNormalized, "lerato@example.co.za"));
    expect(u.emailVerifiedAt).not.toBeNull();
  });

  it("rejects state-changing requests without the CSRF header", async () => {
    const res = await supertest(env.server).post("/api/v1/auth/login").send({ email: "x@example.com", password: "nope" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("csrf_failed");
    expect(res.headers["content-type"]).toMatch(/problem\+json/);
  });

  it("does not reveal whether an email exists on login or password reset", async () => {
    const c = await client(env.server);
    const a = await c.post("/auth/login", { email: "lerato@example.co.za", password: "wrong-password-1" });
    const b = await c.post("/auth/login", { email: "nobody@example.co.za", password: "wrong-password-1" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.detail).toBe(b.body.detail);
    expect((await c.post("/auth/forgot-password", { email: "nobody@example.co.za" })).status).toBe(202);
    expect((await c.post("/auth/forgot-password", { email: "lerato@example.co.za" })).status).toBe(202);
  });

  it("resets a password with an expiring token and revokes old sessions", async () => {
    const old = await client(env.server);
    expect((await old.post("/auth/login", { email: "lerato@example.co.za", password: "a-strong-pass-1" })).status).toBe(200);
    await env.app.notifications.dispatchPending();
    const msg = [...env.outbox].reverse().find((m) => m.to === "lerato@example.co.za" && /reset/i.test(m.subject));
    const token = tokenFrom(msg!.text, "/auth/reset");
    const c = await client(env.server);
    expect((await c.post("/auth/reset-password", { token, password: "new-strong-pass-2" })).status).toBe(200);
    expect((await old.get("/me")).status).toBe(401);
    expect((await c.get("/me")).status).toBe(200);
  });

  it("never lets someone set a password on an existing (e.g. guest-checkout) account via registration", async () => {
    const env2 = env;
    await env2.db.insert(users).values({ email: "guest@example.co.za", emailNormalized: "guest@example.co.za", name: "Guest", role: "client" });
    const attacker = await client(env.server);
    const res = await attacker.post("/auth/register", { name: "Attacker", email: "guest@example.co.za", password: "attacker-pass-9" });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("check_email");
    expect((await attacker.get("/me")).status).toBe(401);
    const [u] = await env.db.select().from(users).where(eq(users.emailNormalized, "guest@example.co.za"));
    expect(u.passwordHash).toBeNull();
  });

  it("locks the account after repeated failures", async () => {
    const { user } = await createUser(env);
    const c = await client(env.server);
    for (let i = 0; i < 8; i++) await c.post("/auth/login", { email: user.email, password: "wrong-password-1" });
    const locked = await c.post("/auth/login", { email: user.email, password: PASSWORD });
    expect(locked.status).toBe(429);
  });

  it("requires a TOTP code at login once MFA is enabled, and gates staff routes until verified", async () => {
    const { user, c } = await createUser(env, { role: "admin" });
    const setup = await c.post("/auth/mfa/setup");
    expect(setup.status).toBe(200);
    expect((await c.post("/auth/mfa/enable", { code: "000000" })).status).toBe(400);
    expect((await c.post("/auth/mfa/enable", { code: totp(setup.body.secret) })).status).toBe(200);

    const fresh = await client(env.server);
    const noCode = await fresh.post("/auth/login", { email: user.email, password: PASSWORD });
    expect(noCode.status).toBe(401);
    expect(noCode.body.code).toBe("mfa_required");
    const [row] = await env.db.select().from(users).where(eq(users.id, user.id));
    const ok = await fresh.post("/auth/login", { email: user.email, password: PASSWORD, mfaCode: totp(decrypt(row.mfaSecret!, env.app.config.APP_SECRET)) });
    expect(ok.status).toBe(200);
    expect((await fresh.get("/admin/dashboard")).status).toBe(200);

    // With mandatory staff MFA, a staff member without MFA is blocked from the console.
    await env.db.execute(sql`insert into settings (key, value) values ('security', '{"requireStaffMfa": true, "sessionDays": 14}') on conflict (key) do update set value = excluded.value`);
    env.app.settings.invalidate();
    const { c: staff } = await createUser(env, { role: "staff" });
    const blocked = await staff.get("/admin/leads");
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("mfa_required");
    await env.db.execute(sql`delete from settings where key = 'security'`);
    env.app.settings.invalidate();
  });

  it("revokes sessions when a user is disabled", async () => {
    const { c: owner } = await createUser(env, { role: "owner" });
    const { user, c } = await createUser(env);
    expect((await c.get("/me")).status).toBe(200);
    expect((await owner.patch(`/admin/users/${user.id}`, { status: "disabled" })).status).toBe(200);
    expect((await c.get("/me")).status).toBe(401);
  });
});
