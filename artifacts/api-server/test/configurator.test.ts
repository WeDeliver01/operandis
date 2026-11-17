import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { configuratorSubmissions, estimates, leads, notifications } from "@workspace/db";
import { estimateProject, pricingRulesSchema, DEMO_PRICING_RULES, configuratorSubmissionAnswers } from "@workspace/domain";
import { client, createUser, idem, sampleAnswers, setupTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => env.close());

describe("configurator", () => {
  it("exposes the option catalogue without pricing coefficients", async () => {
    const c = await client(env.server);
    const res = await c.get("/configurator/schema");
    expect(res.status).toBe(200);
    expect(res.body.pricingActive).toBe(true);
    expect(res.body.demoPricing).toBe(true);
    expect(res.body.solutions.length).toBeGreaterThan(3);
    expect(JSON.stringify(res.body)).not.toMatch(/amountMinor|baseMinor|multiplierBps/);
  });

  it("autosaves and resumes a draft via its secret token", async () => {
    const c = await client(env.server);
    const created = await c.post("/configurator/drafts", { answers: { context: { name: "Sipho" } }, currentStep: "context" });
    expect(created.status).toBe(201);
    const token = created.body.token;
    const upd = await c.patch(`/configurator/drafts/${token}`, { answers: { context: { name: "Sipho", email: "sipho@example.co.za" }, problem: { description: "Too many spreadsheets" } }, currentStep: "solution", sendResumeLink: true });
    expect(upd.status).toBe(200);
    const resumed = await (await client(env.server)).get(`/configurator/drafts/${token}`);
    expect(resumed.body.currentStep).toBe("solution");
    expect(resumed.body.answers.context.email).toBe("sipho@example.co.za");
    expect(resumed.body.token).toBeUndefined();
    expect((await c.get(`/configurator/drafts/${"x".repeat(32)}`)).status).toBe(404);
    await env.app.notifications.dispatchPending();
    expect(env.outbox.some((m) => m.to === "sipho@example.co.za" && m.text.includes(`/configure?resume=${token}`))).toBe(true);
  });

  it("creates lead, brief and server-side estimate exactly once per idempotency key", async () => {
    const c = await client(env.server);
    const key = idem();
    const answers = sampleAnswers();
    const first = await c.post("/configurator/submissions", { answers, idempotencyKey: key });
    expect(first.status).toBe(201);
    const second = await c.post("/configurator/submissions", { answers, idempotencyKey: key });
    expect(second.status).toBe(200);
    expect(second.body.submissionReference).toBe(first.body.submissionReference);

    const subs = await env.db.select().from(configuratorSubmissions).where(eq(configuratorSubmissions.idempotencyKey, key));
    expect(subs).toHaveLength(1);
    const ests = await env.db.select().from(estimates).where(eq(estimates.submissionId, subs[0].id));
    expect(ests).toHaveLength(1);

    // The persisted estimate equals the pure engine output for the same rules.
    const expected = estimateProject(configuratorSubmissionAnswers.parse(answers), pricingRulesSchema.parse(DEMO_PRICING_RULES));
    expect(first.body.result.totalMinor).toBe(expected.totalMinor);
    expect(first.body.result.lowMinor).toBe(expected.lowMinor);
    expect(first.body.isDemoPricing).toBe(true);
    expect(first.body.result.statement).toMatch(/non-binding/);
  });

  it("deduplicates leads by normalised email but flags a different company as a possible duplicate", async () => {
    const c = await client(env.server);
    await c.post("/configurator/submissions", { answers: sampleAnswers({ context: { ...sampleAnswers().context, email: "DUP@Example.co.za" } }), idempotencyKey: idem() });
    await c.post("/contact", { name: "Thandi", email: "dup@example.co.za", company: "Acme Logistics", message: "Following up on my brief please.", consentProcessing: true });
    let rows = await env.db.select().from(leads).where(eq(leads.emailNormalized, "dup@example.co.za"));
    expect(rows).toHaveLength(1);
    await c.post("/contact", { name: "Thandi", email: "dup@example.co.za", company: "Other Company", message: "A different business entirely.", consentProcessing: true });
    rows = await env.db.select().from(leads).where(eq(leads.emailNormalized, "dup@example.co.za"));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.companyName === "Other Company")?.possibleDuplicateOfId).toBe(rows.find((r) => r.companyName === "Acme Logistics")?.id);
  });

  it("flags complex briefs for manual review and recommends paid discovery", async () => {
    const c = await client(env.server);
    const res = await c.post("/configurator/submissions", {
      answers: sampleAnswers({
        solution: { types: ["mobile_app"] },
        capabilities: { features: ["user_accounts", "offline_mode", "sensitive_data"] },
        platforms: { platforms: ["ios", "android"], branding: "none" },
      }),
      idempotencyKey: idem(),
    });
    expect(res.status).toBe(201);
    expect(res.body.result.requiresManualReview).toBe(true);
    expect(res.body.result.recommendation).toBe("paid_discovery");
    expect(res.body.discoveryPackageSlug).toBe("discovery-sprint");
    // Staff are alerted with the review flags.
    const [n] = await env.db.select().from(notifications).where(sql`${notifications.template} = 'staff.new_lead' and ${notifications.data}->>'flags' like '%native_mobile%'`);
    expect(n).toBeTruthy();
  });

  it("rejects answers that violate the active rules (dependencies, unknown keys) server-side", async () => {
    const c = await client(env.server);
    const bad = await c.post("/configurator/submissions", { answers: sampleAnswers({ capabilities: { features: ["subscriptions"] } }), idempotencyKey: idem() });
    expect(bad.status).toBe(422);
    const unknown = await c.post("/configurator/submissions", { answers: sampleAnswers({ solution: { types: ["spaceship"] } }), idempotencyKey: idem() });
    expect(unknown.status).toBe(422);
    const noConsent = await c.post("/configurator/submissions", { answers: sampleAnswers({ review: { consentProcessing: false } }), idempotencyKey: idem() });
    expect(noConsent.status).toBe(400);
    const spam = await c.post("/configurator/submissions", { answers: sampleAnswers(), idempotencyKey: idem(), website: "http://spam" });
    expect(spam.status).toBe(400);
  });

  it("only shows an assessment to holders of its private link", async () => {
    const c = await client(env.server);
    const res = await c.post("/configurator/submissions", { answers: sampleAnswers(), idempotencyKey: idem() });
    const ref = res.body.submissionReference;
    expect((await c.get(`/configurator/estimates/${ref}?token=${res.body.accessToken}`)).status).toBe(200);
    expect((await c.get(`/configurator/estimates/${ref}?token=wrongtoken`)).status).toBe(404);
  });

  it("still records the brief (without numbers) when no pricing version is active", async () => {
    await env.db.execute(sql`update pricing_rule_versions set status = 'retired'`);
    const c = await client(env.server);
    const res = await c.post("/configurator/submissions", { answers: sampleAnswers(), idempotencyKey: idem() });
    expect(res.status).toBe(201);
    expect(res.body.result).toBeNull();
    expect(res.body.status).toBe("submitted");
    await env.db.execute(sql`update pricing_rule_versions set status = 'active' where version = 1`);
  });

  it("lets admins version pricing rules: drafts are editable with optimistic locking, only owners approve real rate cards", async () => {
    const { c: admin } = await createUser(env, { role: "admin" });
    const { c: owner } = await createUser(env, { role: "owner" });
    const created = await admin.post("/admin/pricing-rules", { name: "2027 rate card", rules: DEMO_PRICING_RULES, isDemo: false });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const edit = await admin.patch(`/admin/pricing-rules/${id}`, { notes: "tweak", rowVersion: created.body.rowVersion });
    expect(edit.status).toBe(200);
    const stale = await admin.patch(`/admin/pricing-rules/${id}`, { notes: "stale", rowVersion: created.body.rowVersion });
    expect(stale.status).toBe(409);
    expect((await admin.post(`/admin/pricing-rules/${id}/activate`, { rowVersion: edit.body.rowVersion })).status).toBe(403);
    expect((await owner.post(`/admin/pricing-rules/${id}/activate`, { rowVersion: edit.body.rowVersion })).status).toBe(200);
    const active = await env.db.execute(sql`select count(*)::int as n from pricing_rule_versions where status = 'active'`);
    expect(active.rows[0].n).toBe(1);
    expect((await admin.patch(`/admin/pricing-rules/${id}`, { notes: "x", rowVersion: edit.body.rowVersion + 1 })).status).toBe(409);
  });
});
