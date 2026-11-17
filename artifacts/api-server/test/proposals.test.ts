import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { invoices, leads, milestones, orders, projects, proposals, users } from "@workspace/db";
import { client, createUser, idem, postItn, payfastItn, sampleAnswers, setupTestEnv, verifyUserEmail, type Client, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => env.close());

describe("lead → proposal → acceptance → deposit → project", () => {
  let admin: Client;
  let clientC: Client;
  let submissionId: string;
  let proposalV1: { id: string; rowVersion: number; contentHash: string };
  let proposalV2Id: string;

  it("captures a brief and the client can access the portal after verifying", async () => {
    const visitor = await client(env.server);
    const sub = await visitor.post("/configurator/submissions", { answers: sampleAnswers({ context: { ...sampleAnswers().context, email: "ops@acme.co.za" } }), idempotencyKey: idem() });
    expect(sub.status).toBe(201);
    const [row] = await env.db.select().from(users).where(eq(users.emailNormalized, "ops@acme.co.za"));
    expect(row.passwordHash).toBeNull(); // passwordless client account created for the brief
    ({ c: admin } = await createUser(env, { role: "admin" }));
    const list = await admin.get("/admin/submissions");
    submissionId = list.body.items.find((s: { reference: string }) => s.reference === sub.body.submissionReference).id;
    expect(submissionId).toBeTruthy();
  });

  it("drafts a proposal from the brief with server-calculated totals", async () => {
    const created = await admin.post("/admin/proposals/from-submission", { submissionId });
    expect(created.status).toBe(201);
    const detail = await admin.get(`/admin/proposals/${created.body.id}`);
    const p = detail.body.proposal;
    expect(p.status).toBe("draft");
    expect(p.totalMinor).toBeGreaterThan(0);
    expect(p.milestones.reduce((s: number, m: { amountMinor: number }) => s + m.amountMinor, 0)).toBe(p.totalMinor);
    // Clients never see drafts.
    proposalV1 = { id: p.id, rowVersion: p.rowVersion, contentHash: "" };
  });

  it("sends the proposal: freezes a content hash and emails a passwordless sign-in link", async () => {
    const sent = await admin.post(`/admin/proposals/${proposalV1.id}/send`, { rowVersion: proposalV1.rowVersion });
    expect(sent.status).toBe(200);
    proposalV1.contentHash = sent.body.contentHash;
    const [lead] = await env.db.select().from(leads).where(eq(leads.emailNormalized, "ops@acme.co.za"));
    expect(lead.status).toBe("proposal_sent");
    await env.app.notifications.dispatchPending();
    const mail = [...env.outbox].reverse().find((m) => m.to === "ops@acme.co.za" && m.subject.startsWith("Proposal"));
    const token = /\/auth\/magic\?token=([A-Za-z0-9_-]+)/.exec(mail!.text)?.[1];
    expect(token).toBeTruthy();
    clientC = await client(env.server);
    const consume = await clientC.post("/auth/magic-link/consume", { token });
    expect(consume.status).toBe(200);
    expect(consume.body.hasPassword).toBe(false);
  });

  it("client views the proposal (recorded) and a revision creates version 2", async () => {
    const view = await clientC.get(`/portal/proposals/${proposalV1.id}`);
    expect(view.status).toBe(200);
    expect(view.body.proposal.status).toBe("viewed");
    expect((await clientC.post(`/portal/proposals/${proposalV1.id}/messages`, { body: "Can milestone 2 move a week earlier?" })).status).toBe(201);

    const detail = await admin.get(`/admin/proposals/${proposalV1.id}`);
    expect(detail.body.thread.length).toBe(1);
    const edit = await admin.patch(`/admin/proposals/${proposalV1.id}`, { rowVersion: detail.body.proposal.rowVersion, timelineSummary: "Revised timeline: beta one week earlier." });
    expect(edit.status).toBe(200);
    expect(edit.body.newVersion).toBe(true);
    expect(edit.body.version).toBe(2);
    proposalV2Id = edit.body.id;
    const [v1] = await env.db.select().from(proposals).where(eq(proposals.id, proposalV1.id));
    expect(v1.status).toBe("superseded");
  });

  it("acceptance binds to the exact current version", async () => {
    const oldAccept = await clientC.post(`/portal/proposals/${proposalV1.id}/accept`, { proposalId: proposalV1.id, contentHash: proposalV1.contentHash, confirm: true });
    expect(oldAccept.status).toBe(422);
    const v2 = await admin.get(`/admin/proposals/${proposalV2Id}`);
    const sent = await admin.post(`/admin/proposals/${proposalV2Id}/send`, { rowVersion: v2.body.proposal.rowVersion });
    expect(sent.status).toBe(200);
    const tampered = await clientC.post(`/portal/proposals/${proposalV2Id}/accept`, { proposalId: proposalV2Id, contentHash: "0".repeat(64), confirm: true });
    expect(tampered.status).toBe(409);
    const accept = await clientC.post(`/portal/proposals/${proposalV2Id}/accept`, { proposalId: proposalV2Id, contentHash: sent.body.contentHash, confirm: true });
    expect(accept.status).toBe(200);
    expect(accept.body.depositInvoiceId).toBeTruthy();
    const again = await clientC.post(`/portal/proposals/${proposalV2Id}/accept`, { proposalId: proposalV2Id, contentHash: sent.body.contentHash, confirm: true });
    expect(again.status).toBe(409);

    const [p] = await env.db.select().from(proposals).where(eq(proposals.id, proposalV2Id));
    expect(p.status).toBe("accepted");
    expect(p.contentHash).toBe(sent.body.contentHash);
    const [order] = await env.db.select().from(orders).where(eq(orders.proposalId, p.id));
    expect(order).toMatchObject({ status: "confirmed", totalMinor: p.totalMinor, source: "proposal" });
    const [project] = await env.db.select().from(projects).where(eq(projects.orderId, order.id));
    expect(project.status).toBe("awaiting_deposit");
    const ms = await env.db.select().from(milestones).where(eq(milestones.projectId, project.id));
    expect(ms.reduce((s, m) => s + m.amountMinor, 0)).toBe(p.totalMinor);
    const [lead] = await env.db.select().from(leads).where(eq(leads.id, p.leadId!));
    expect(lead.status).toBe("won");
  });

  it("blocks work until the deposit is paid; client pays the deposit invoice online", async () => {
    const [project] = await env.db.select().from(projects).where(eq(projects.proposalId, proposalV2Id));
    const blocked = await admin.patch(`/admin/projects/${project.id}`, { status: "in_progress" });
    expect(blocked.status).toBe(422);

    const dash = await clientC.get("/portal/dashboard");
    expect(dash.status).toBe(200);
    expect(dash.body.finance.outstandingMinor).toBeGreaterThan(0);
    expect(dash.body.actions.some((a: { kind: string }) => a.kind === "invoice")).toBe(true);

    const pay = await clientC.post(`/portal/invoices/${project.depositInvoiceId}/pay`, { provider: "payfast" });
    expect(pay.status).toBe(200);
    const [inv] = await env.db.select().from(invoices).where(eq(invoices.id, project.depositInvoiceId!));
    const itn = await postItn(env, payfastItn({ m_payment_id: pay.body.reference, pf_payment_id: "PF-DEP-1", payment_status: "COMPLETE", amount_gross: (inv.totalMinor / 100).toFixed(2) }));
    expect(itn.body.status).toBe("processed");
    const [paidInv] = await env.db.select().from(invoices).where(eq(invoices.id, inv.id));
    expect(paidInv.status).toBe("paid");
    const [ready] = await env.db.select().from(projects).where(eq(projects.id, project.id));
    expect(ready.status).toBe("not_started");
    expect((await admin.patch(`/admin/projects/${project.id}`, { status: "in_progress" })).status).toBe(200);

    const view = await clientC.get(`/portal/projects/${project.id}`);
    expect(view.status).toBe(200);
    expect(view.body.finance.paidToDateMinor).toBe(inv.totalMinor);
    expect(view.body.project.status).toBe("in_progress");
  });

  it("issues milestone invoices once and supports change requests", async () => {
    const [project] = await env.db.select().from(projects).where(eq(projects.proposalId, proposalV2Id));
    const ms = await env.db.select().from(milestones).where(eq(milestones.projectId, project.id));
    const beta = ms.find((m) => !m.invoiceId && m.billable)!;
    const inv = await admin.post(`/admin/projects/${project.id}/milestones/${beta.id}/invoice`, {});
    expect(inv.status).toBe(201);
    expect((await admin.post(`/admin/projects/${project.id}/milestones/${beta.id}/invoice`, {})).status).toBe(409);

    const cr = await clientC.post("/portal/change-requests", { projectId: project.id, type: "change", title: "Add a driver app", description: "We'd like drivers to see their routes on their phones." });
    expect(cr.status).toBe(201);
    const quote = await admin.patch(`/admin/change-requests/${cr.body.id}`, { status: "quoted", impactEstimateMinor: 2_500_000, impactDays: 10, response: "Happy to — quote attached." });
    expect(quote.status).toBe(200);
    expect((await clientC.post(`/portal/change-requests/${cr.body.id}/decision`, { decision: "approve" })).body.status).toBe("approved");

    const defect = await clientC.post("/portal/change-requests", { projectId: project.id, type: "defect", title: "Login button", description: "The login button does nothing on Safari." });
    expect((await admin.patch(`/admin/change-requests/${defect.body.id}`, { status: "quoted", impactEstimateMinor: 1000 })).status).toBe(422);
  });

  it("records an audited deposit exception for trusted clients", async () => {
    const { c: staff } = await createUser(env, { role: "staff" });
    const created = await admin.post("/admin/projects", { organizationId: (await env.db.select().from(projects).limit(1))[0].organizationId, name: "Retainer work", depositRequired: true, contractValueMinor: 1_000_000 });
    expect(created.status).toBe(201);
    expect((await admin.patch(`/admin/projects/${created.body.id}`, { status: "in_progress" })).status).toBe(422);
    expect((await staff.post(`/admin/projects/${created.body.id}/deposit-exception`, { reason: "Owner approved — long-standing client" })).status).toBe(403);
    expect((await admin.post(`/admin/projects/${created.body.id}/deposit-exception`, { reason: "Owner approved — long-standing client" })).status).toBe(200);
    expect((await admin.patch(`/admin/projects/${created.body.id}`, { status: "in_progress" })).status).toBe(200);
  });
});

void verifyUserEmail;
