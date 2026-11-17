import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { invoices, notifications, orders, packages, paymentAttempts, paymentTransactions, projects, webhookEvents } from "@workspace/db";
import { client, createUser, idem, postItn, payfastItn, PAYFAST, setupTestEnv, type TestEnv } from "./helpers";
import { payfastSignature } from "../src/services/payments/payfast";
import { yocoSignature } from "../src/services/payments/yoco";

let env: TestEnv;
let termsVersion: string;
beforeAll(async () => {
  env = await setupTestEnv();
  termsVersion = (await env.app.settings.commerce()).termsVersion;
});
afterAll(async () => env.close());

const billing = (email = `buyer-${crypto.randomUUID().slice(0, 8)}@example.co.za`) => ({ name: "Naledi Khumalo", email, company: "Khumalo Studio" });

async function checkout(body: Record<string, unknown> = {}) {
  const c = await client(env.server);
  const res = await c.post("/checkout/sessions", {
    packageSlug: "business-website",
    selection: { variantKey: "growth", options: [{ key: "extra_pages", quantity: 2 }] },
    billing: billing(),
    acceptTerms: true,
    termsVersion,
    provider: "payfast",
    idempotencyKey: idem(),
    ...body,
  });
  return { c, res };
}

describe("package quote & checkout", () => {
  it("calculates the authoritative price server-side", async () => {
    const c = await client(env.server);
    const q = await c.post("/packages/business-website/quote", { variantKey: "growth", options: [{ key: "extra_pages", quantity: 2 }] });
    expect(q.status).toBe(200);
    expect(q.body.totalMinor).toBe(3_200_000 + 2 * 150_000);
    expect(q.body.depositMinor).toBe(1_750_000);
    expect(q.body.purchasable).toBe(true);
    const bad = await c.post("/packages/business-website/quote", { variantKey: "growth", options: [{ key: "extra_pages", quantity: 999 }] });
    expect(bad.status).toBe(422);
    const review = await c.post("/packages/business-website/quote", { variantKey: "growth", options: [{ key: "custom_integration", quantity: 1 }] });
    expect(review.body.purchasable).toBe(false);
  });

  it("creates a pending order and a correctly signed PayFast form", async () => {
    const { res } = await checkout();
    expect(res.status).toBe(201);
    const pay = res.body.payment;
    expect(pay.provider).toBe("payfast");
    expect(pay.method).toBe("POST");
    expect(pay.url).toBe("https://sandbox.payfast.co.za/eng/process");
    expect(pay.fields.amount).toBe("17500.00");
    const { signature, ...rest } = pay.fields;
    expect(payfastSignature(Object.entries(rest) as [string, string][], PAYFAST.passphrase)).toBe(signature);
    expect(pay.fields.notify_url).toBe("http://api.test/api/v1/webhooks/payments/payfast");
    const [order] = await env.db.select().from(orders).where(eq(orders.id, res.body.orderId));
    expect(order.status).toBe("pending_payment");
    // A redirect alone never marks anything paid.
    const status = await (await client(env.server)).get(`/checkout/orders/${res.body.orderReference}?token=${res.body.accessToken}`);
    expect(status.body.status).toBe("pending_payment");
  });

  it("is idempotent for the same checkout key", async () => {
    const key = idem();
    const a = await checkout({ idempotencyKey: key });
    const b = await checkout({ idempotencyKey: key });
    expect(b.res.status).toBe(200);
    expect(b.res.body.orderId).toBe(a.res.body.orderId);
    const rows = await env.db.select().from(orders).where(eq(orders.idempotencyKey, key));
    expect(rows).toHaveLength(1);
  });

  it("refuses a stale package version and asks existing account holders to sign in", async () => {
    const stale = await checkout({ expectedVersion: 0 });
    expect(stale.res.status).toBe(409);
    const { user } = await createUser(env);
    const existing = await checkout({ billing: billing(user.email) });
    expect(existing.res.status).toBe(409);
    expect(existing.res.body.code).toBe("account_exists");
    const terms = await checkout({ termsVersion: "old" });
    expect(terms.res.status).toBe(409);
  });
});

describe("PayFast ITN processing", () => {
  it("confirms the order exactly once on a verified COMPLETE notification", async () => {
    const { res } = await checkout();
    const ref = res.body.payment.reference;
    const body = payfastItn({ m_payment_id: ref, pf_payment_id: "PF-1001", payment_status: "COMPLETE", amount_gross: "17500.00" });
    const first = await postItn(env, body);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("processed");

    const [order] = await env.db.select().from(orders).where(eq(orders.id, res.body.orderId));
    expect(order.status).toBe("confirmed");
    const invs = await env.db.select().from(invoices).where(eq(invoices.orderId, order.id));
    expect(invs).toHaveLength(1);
    expect(invs[0]).toMatchObject({ status: "paid", totalMinor: 1_750_000, amountPaidMinor: 1_750_000, kind: "deposit" });
    expect(invs[0].number).toMatch(/^INV-\d{4}-\d{5}$/);
    const proj = await env.db.select().from(projects).where(eq(projects.orderId, order.id));
    expect(proj).toHaveLength(1);
    expect(proj[0].depositPaidAt).not.toBeNull();

    // Duplicate delivery: no new transaction, invoice or notification.
    const dup = await postItn(env, body);
    expect(dup.status).toBe(200);
    expect(dup.body.status).toBe("duplicate");
    expect(await env.db.select().from(paymentTransactions).where(eq(paymentTransactions.providerTransactionId, "PF-1001"))).toHaveLength(1);
    expect(await env.db.select().from(invoices).where(eq(invoices.orderId, order.id))).toHaveLength(1);
    const notes = await env.db.select().from(notifications).where(and(eq(notifications.template, "order.confirmed"), eq(notifications.channel, "email"), sql`${notifications.data}->>'orderReference' = ${order.reference}`));
    expect(notes).toHaveLength(1);
    const [ev] = await env.db.select().from(webhookEvents).where(eq(webhookEvents.eventId, "PF-1001:COMPLETE"));
    expect(ev.retryCount).toBe(1);

    // Out-of-order FAILED after COMPLETE must not downgrade the payment.
    const late = await postItn(env, payfastItn({ m_payment_id: ref, pf_payment_id: "PF-1001", payment_status: "FAILED", amount_gross: "17500.00" }));
    expect(late.body.status).toBe("ignored");
    const [att] = await env.db.select().from(paymentAttempts).where(eq(paymentAttempts.reference, ref));
    expect(att.status).toBe("succeeded");
  });

  it("rejects forged signatures and amount mismatches without changing state", async () => {
    const { res } = await checkout();
    const ref = res.body.payment.reference;
    const forged = await postItn(env, payfastItn({ m_payment_id: ref, pf_payment_id: "PF-2001", payment_status: "COMPLETE", amount_gross: "17500.00" }, { tamper: true }));
    expect(forged.status).toBe(400);
    const cheap = await postItn(env, payfastItn({ m_payment_id: ref, pf_payment_id: "PF-2002", payment_status: "COMPLETE", amount_gross: "1.00" }));
    expect(cheap.body.status).toBe("rejected");
    const [order] = await env.db.select().from(orders).where(eq(orders.id, res.body.orderId));
    expect(order.status).toBe("pending_payment");
    expect(await env.db.select().from(paymentTransactions).where(eq(paymentTransactions.providerTransactionId, "PF-2002"))).toHaveLength(0);
    const rejected = await env.db.select().from(webhookEvents).where(eq(webhookEvents.processingStatus, "rejected"));
    expect(rejected.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps a failed payment unpaid and allows a safe retry", async () => {
    const { c, res } = await checkout();
    const ref = res.body.payment.reference;
    const failed = await postItn(env, payfastItn({ m_payment_id: ref, pf_payment_id: "PF-3001", payment_status: "FAILED", amount_gross: "17500.00" }));
    expect(failed.body.status).toBe("processed");
    const status = await c.get(`/checkout/orders/${res.body.orderReference}?token=${res.body.accessToken}`);
    expect(status.body).toMatchObject({ status: "pending_payment", paymentStatus: "failed", canRetry: true });
    const retry = await c.post(`/checkout/orders/${res.body.orderReference}/retry`, { token: res.body.accessToken });
    expect(retry.status).toBe(200);
    const newRef = retry.body.payment.reference;
    expect(newRef).not.toBe(ref);
    const ok = await postItn(env, payfastItn({ m_payment_id: newRef, pf_payment_id: "PF-3002", payment_status: "COMPLETE", amount_gross: "17500.00" }));
    expect(ok.body.status).toBe("processed");
    const orderRows = await env.db.select().from(orders).where(eq(orders.reference, res.body.orderReference));
    expect(orderRows[0].status).toBe("confirmed");
    expect(await env.db.select().from(invoices).where(eq(invoices.orderId, orderRows[0].id))).toHaveLength(1);
  });

  it("does not mutate existing orders when a package price changes", async () => {
    const { res } = await checkout();
    const [before] = await env.db.select().from(orders).where(eq(orders.id, res.body.orderId));
    const { c: admin } = await createUser(env, { role: "admin" });
    const [pkg] = await env.db.select().from(packages).where(eq(packages.slug, "business-website"));
    const detail = await admin.get(`/admin/packages/${pkg.id}`);
    const growth = detail.body.variants.find((v: { key: string }) => v.key === "growth");
    const upd = await admin.put(`/admin/packages/${pkg.id}/variants/${growth.id}`, { ...growth, id: undefined, priceMinor: 9_900_000 });
    expect(upd.status).toBe(200);
    expect(upd.body.version).toBeGreaterThan(before.packageVersion!);
    const [after] = await env.db.select().from(orders).where(eq(orders.id, res.body.orderId));
    expect(after.totalMinor).toBe(before.totalMinor);
    expect(after.snapshot).toEqual(before.snapshot);
    // The original attempt still reconciles at the original price.
    const ok = await postItn(env, payfastItn({ m_payment_id: res.body.payment.reference, pf_payment_id: "PF-4001", payment_status: "COMPLETE", amount_gross: "17500.00" }));
    expect(ok.body.status).toBe("processed");
  });
});

describe("Yoco webhooks", () => {
  it("verifies Standard-Webhooks signatures and rejects stale timestamps", async () => {
    const secret = env.app.config.YOCO_WEBHOOK_SECRET!;
    const body = JSON.stringify({ id: "evt_1", type: "payment.succeeded", payload: { id: "p_1", amount: 100, currency: "ZAR", metadata: { reference: "PAY-NOPE" } } });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = yocoSignature(secret, "evt_1", ts, body);
    const ok = await supertest(env.server).post("/api/v1/webhooks/payments/yoco").set({ "content-type": "application/json", "webhook-id": "evt_1", "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` }).send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("rejected"); // signature fine, but unknown reference
    const bad = await supertest(env.server).post("/api/v1/webhooks/payments/yoco").set({ "content-type": "application/json", "webhook-id": "evt_2", "webhook-timestamp": ts, "webhook-signature": "v1,AAAA" }).send(body);
    expect(bad.status).toBe(400);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const stale = await supertest(env.server).post("/api/v1/webhooks/payments/yoco").set({ "content-type": "application/json", "webhook-id": "evt_3", "webhook-timestamp": old, "webhook-signature": `v1,${yocoSignature(secret, "evt_3", old, body)}` }).send(body);
    expect(stale.status).toBe(400);
  });
});

describe("EFT, offline confirmation and refunds", () => {
  it("records EFT only after finance confirms funds, then refunds with a credit note", async () => {
    const { c, res } = await checkout({ provider: "eft" });
    expect(res.status).toBe(201);
    expect(res.body.payment.method).toBe("NONE");
    expect(res.body.payment.eft.reference).toBe(res.body.payment.reference);
    const [attempt] = await env.db.select().from(paymentAttempts).where(eq(paymentAttempts.reference, res.body.payment.reference));
    expect(attempt.status).toBe("created");

    const { c: staff } = await createUser(env, { role: "staff" });
    const { c: finance } = await createUser(env, { role: "finance" });
    const offline = { attemptId: attempt.id, amountMinor: attempt.amountMinor, bankReference: "FNB-778899", receivedAt: new Date().toISOString() };
    expect((await staff.post("/admin/payments/offline", offline)).status).toBe(403);
    const wrongAmount = await finance.post("/admin/payments/offline", { ...offline, amountMinor: 100 });
    expect(wrongAmount.status).toBe(422);
    const confirmed = await finance.post("/admin/payments/offline", offline);
    expect(confirmed.status).toBe(201);
    expect((await finance.post("/admin/payments/offline", offline)).status).toBe(409);
    const [order] = await env.db.select().from(orders).where(eq(orders.id, res.body.orderId));
    expect(order.status).toBe("confirmed");
    void c;

    const [txn] = await env.db.select().from(paymentTransactions).where(eq(paymentTransactions.providerTransactionId, "eft:FNB-778899"));
    expect(txn.verificationMethod).toBe("manual_eft");
    expect((await staff.post(`/admin/payments/${txn.id}/refunds`, { amountMinor: 1000, reason: "Goodwill", idempotencyKey: idem() })).status).toBe(403);
    expect((await finance.post(`/admin/payments/${txn.id}/refunds`, { amountMinor: txn.amountMinor + 1, reason: "Too much", idempotencyKey: idem() })).status).toBe(422);
    const key = idem();
    const refund = await finance.post(`/admin/payments/${txn.id}/refunds`, { amountMinor: 500_000, reason: "Scope reduced by agreement", idempotencyKey: key });
    expect(refund.status).toBe(201);
    expect(refund.body.status).toBe("manual_pending"); // EFT has no refund API
    const replay = await finance.post(`/admin/payments/${txn.id}/refunds`, { amountMinor: 500_000, reason: "Scope reduced by agreement", idempotencyKey: key });
    expect(replay.body.id).toBe(refund.body.id);
    const done = await finance.post(`/admin/refunds/${refund.body.id}/complete`, { payoutReference: "EFT-OUT-1" });
    expect(done.status).toBe(200);
    const [inv] = await env.db.select().from(invoices).where(eq(invoices.id, txn.invoiceId!));
    expect(inv).toMatchObject({ status: "partially_refunded", amountRefundedMinor: 500_000 });
    const cn = await env.db.execute(sql`select number, amount_minor from credit_notes where invoice_id = ${inv.id}`);
    expect(cn.rows).toHaveLength(1);
    const auditRows = await env.db.execute(sql`select action from audit_events where entity_type = 'refund' order by created_at`);
    expect(auditRows.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["refund.requested", "refund.completed"]));
  });
});
