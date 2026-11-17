import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { eq, sql } from "drizzle-orm";
import { leads, projects } from "@workspace/db";
import { client, createUser, idem, sampleAnswers, setupTestEnv, type Client, type TestEnv } from "./helpers";
import { routeRegistry, toOpenApiPath } from "../src/lib/route";
import { buildOpenApi } from "../src/modules/openapi";

let env: TestEnv;
let admin: Client;
let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;
let aliceProjectId: string;
let aliceInvoiceId: string;
let aliceProposalId: string;
let aliceFileId: string;
let aliceOrderId: string;

beforeAll(async () => {
  env = await setupTestEnv();
  ({ c: admin } = await createUser(env, { role: "admin" }));
  alice = await createUser(env, { company: "Alice Co" });
  bob = await createUser(env, { company: "Bob Co" });

  // Give Alice a proposal → accepted → project, invoice, order and a file.
  const lead = await admin.post("/admin/leads", { contactName: alice.user.name, email: alice.user.email, companyName: "Alice Co", summary: "Portal build" });
  const created = await admin.post("/admin/proposals", {
    leadId: lead.body.id,
    organizationId: alice.org.id,
    title: "Alice portal",
    lineItems: [{ description: "Build", quantity: 1, unitMinor: 10_000_000 }],
    milestones: [
      { key: "deposit", title: "Deposit", percentBps: 5000 },
      { key: "launch", title: "Launch", percentBps: 5000, targetOffsetDays: 60 },
    ],
  });
  expect(created.status).toBe(201);
  aliceProposalId = created.body.id;
  const d = await admin.get(`/admin/proposals/${aliceProposalId}`);
  const sent = await admin.post(`/admin/proposals/${aliceProposalId}/send`, { rowVersion: d.body.proposal.rowVersion });
  const acc = await alice.c.post(`/portal/proposals/${aliceProposalId}/accept`, { proposalId: aliceProposalId, contentHash: sent.body.contentHash, confirm: true });
  expect(acc.status).toBe(200);
  aliceProjectId = acc.body.projectId;
  aliceInvoiceId = acc.body.depositInvoiceId;
  aliceOrderId = acc.body.orderId;
  const up = await admin.upload("/files", { projectId: aliceProjectId, kind: "deliverable" }, { name: "spec.pdf", data: Buffer.from("%PDF-1.4\n%test\n") });
  expect(up.status).toBe(201);
  aliceFileId = up.body.id;
});
afterAll(async () => env.close());

describe("object-level authorisation (IDOR)", () => {
  it("Alice can read her own records", async () => {
    expect((await alice.c.get(`/portal/projects/${aliceProjectId}`)).status).toBe(200);
    expect((await alice.c.get(`/portal/invoices/${aliceInvoiceId}`)).status).toBe(200);
    expect((await alice.c.get(`/portal/proposals/${aliceProposalId}`)).status).toBe(200);
    expect((await alice.c.get(`/portal/orders/${aliceOrderId}`)).status).toBe(200);
    expect((await alice.c.get(`/files/${aliceFileId}/download-url`)).status).toBe(200);
  });

  it("Bob gets 404 for every one of Alice's records, including writes", async () => {
    for (const p of [`/portal/projects/${aliceProjectId}`, `/portal/invoices/${aliceInvoiceId}`, `/portal/invoices/${aliceInvoiceId}/pdf`, `/portal/proposals/${aliceProposalId}`, `/portal/proposals/${aliceProposalId}/pdf`, `/portal/orders/${aliceOrderId}`, `/files/${aliceFileId}/download-url`]) {
      expect((await bob.c.get(p)).status, p).toBe(404);
    }
    expect((await bob.c.post(`/portal/invoices/${aliceInvoiceId}/pay`, {})).status).toBe(404);
    expect((await bob.c.post(`/portal/proposals/${aliceProposalId}/messages`, { body: "hi" })).status).toBe(404);
    expect((await bob.c.post("/portal/change-requests", { projectId: aliceProjectId, type: "support", title: "Sneaky", description: "Trying another client's project" })).status).toBe(404);
    expect((await bob.c.upload("/files", { projectId: aliceProjectId }, { name: "x.pdf", data: Buffer.from("%PDF-1.4\n") })).status).toBe(404);
    expect((await bob.c.patch(`/portal/organization/${alice.org.id}`, { name: "Owned" })).status).toBe(404);
    const lists = await Promise.all(["/portal/projects", "/portal/invoices", "/portal/proposals", "/portal/orders"].map((p) => bob.c.get(p)));
    lists.forEach((l) => expect(l.body).toEqual([]));
  });

  it("hides internal files and notes from clients", async () => {
    const internal = await admin.upload("/files", { projectId: aliceProjectId, visibility: "internal", kind: "document" }, { name: "costing.csv", data: Buffer.from("a,b\n1,2\n") });
    expect(internal.status).toBe(201);
    expect((await alice.c.get(`/files/${internal.body.id}/download-url`)).status).toBe(404);
    await admin.post(`/admin/projects/${aliceProjectId}/messages`, { body: "Internal: margin is thin", internal: true });
    const view = await alice.c.get(`/portal/projects/${aliceProjectId}`);
    expect(JSON.stringify(view.body)).not.toContain("margin is thin");
    expect(view.body.files.some((f: { id: string }) => f.id === internal.body.id)).toBe(false);
  });

  it("requires a verified email before showing portal data", async () => {
    const unverified = await createUser(env, { verified: false });
    expect((await unverified.c.get("/portal/projects")).status).toBe(403);
    expect((await unverified.c.get("/me")).status).toBe(200);
  });
});

describe("role-based access control", () => {
  it("clients and anonymous users cannot reach admin APIs", async () => {
    expect((await alice.c.get("/admin/leads")).status).toBe(403);
    expect((await alice.c.get("/admin/dashboard")).status).toBe(403);
    expect((await (await client(env.server)).get("/admin/leads")).status).toBe(401);
  });

  it("staff only see leads assigned to them", async () => {
    const { user: staffUser, c: staff } = await createUser(env, { role: "staff" });
    const mine = await admin.post("/admin/leads", { contactName: "Assigned", email: "assigned@example.co.za", summary: "", ownerId: staffUser.id });
    const other = await admin.post("/admin/leads", { contactName: "Unassigned", email: "unassigned@example.co.za", summary: "", ownerId: null });
    expect((await staff.get(`/admin/leads/${mine.body.id}`)).status).toBe(200);
    expect((await staff.get(`/admin/leads/${other.body.id}`)).status).toBe(404);
    const list = await staff.get("/admin/leads");
    expect(list.body.items.every((l: { ownerId: string }) => l.ownerId === staffUser.id)).toBe(true);
    // Staff can't reassign leads to someone else.
    const { user: other2 } = await createUser(env, { role: "staff" });
    expect((await staff.patch(`/admin/leads/${mine.body.id}`, { ownerId: other2.id })).status).toBe(403);
    expect((await staff.get("/admin/settings")).status).toBe(403);
    expect((await staff.get("/admin/pricing-rules")).status).toBe(403);
  });

  it("prevents privilege escalation", async () => {
    const { user: adminUser } = await createUser(env, { role: "admin" });
    const target = await createUser(env, { role: "staff" });
    expect((await admin.patch(`/admin/users/${target.user.id}`, { role: "owner" })).status).toBe(403);
    expect((await admin.patch(`/admin/users/${target.user.id}`, { role: "admin" })).status).toBe(403);
    expect((await admin.patch(`/admin/users/${target.user.id}`, { role: "finance" })).status).toBe(200);
    expect((await admin.post("/admin/users", { name: "Sneaky", email: "sneaky@example.co.za", role: "owner" })).status).toBe(403);
    expect((await admin.put("/admin/settings/tax", { value: { enabled: true, rateBps: 1500, label: "VAT", pricesIncludeTax: false, vatNumber: "4123456789", confirmedByOwner: true } })).status).toBe(403);
    expect((await target.c.patch(`/admin/users/${adminUser.id}`, { status: "disabled" })).status).toBe(401); // sessions revoked on role change
  });
});

describe("files and uploads", () => {
  it("rejects disguised and disallowed file types", async () => {
    const html = await alice.c.upload("/files", { projectId: aliceProjectId }, { name: "notes.txt", data: Buffer.from("<script>alert(1)</script>") });
    expect(html.status).toBe(415);
    const exe = await alice.c.upload("/files", { projectId: aliceProjectId }, { name: "invoice.pdf", data: Buffer.from("MZ\x90\x00binary") });
    expect(exe.status).toBe(415);
    const svg = await alice.c.upload("/files", { projectId: aliceProjectId }, { name: "logo.svg", data: Buffer.from("<svg onload=alert(1)>") });
    expect(svg.status).toBe(415);
    const ok = await alice.c.upload("/files", { projectId: aliceProjectId }, { name: "brief.pdf", data: Buffer.from("%PDF-1.7\nhello") });
    expect(ok.status).toBe(201);
    expect(ok.body.kind).toBe("client_upload");
  });

  it("serves files only through short-lived signed links", async () => {
    const link = await alice.c.get(`/files/${aliceFileId}/download-url`);
    const url = new URL(link.body.url);
    const res = await supertest(env.server).get(`${url.pathname}${url.search}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    const tampered = new URLSearchParams(url.search);
    tampered.set("exp", String(Number(tampered.get("exp")) + 1000));
    expect((await supertest(env.server).get(`${url.pathname}?${tampered}`)).status).toBe(404);
    const expired = new URLSearchParams(url.search);
    expired.set("exp", "1000");
    expect((await supertest(env.server).get(`${url.pathname}?${expired}`)).status).toBe(404);
  });
});

describe("data integrity", () => {
  it("audit log is append-only at the database level", async () => {
    await expect(env.db.execute(sql`update audit_events set action = 'tampered'`)).rejects.toThrow();
    await expect(env.db.execute(sql`delete from audit_events`)).rejects.toThrow();
  });

  it("financial records cannot be hard-deleted", async () => {
    await expect(env.db.execute(sql`delete from invoices`)).rejects.toThrow();
    await expect(env.db.execute(sql`delete from orders`)).rejects.toThrow();
  });

  it("issues gapless, unique invoice numbers under concurrency", async () => {
    const { nextNumber } = await import("../src/lib/db-helpers");
    const results = await Promise.all(Array.from({ length: 15 }, () => env.db.transaction((tx) => nextNumber(tx, "TST"))));
    expect(new Set(results).size).toBe(15);
    const nums = results.map((r) => Number(r.split("-").pop())).sort((a, b) => a - b);
    expect(nums[nums.length - 1] - nums[0]).toBe(14);
  });

  it("logs errors as problem+json with a request id", async () => {
    const res = await supertest(env.server).get("/api/v1/nope").set("x-request-id", "test-request-12345");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "not_found", requestId: "test-request-12345" });
  });

  it("does not leak lead data to the public estimate endpoint without a token", async () => {
    const c = await client(env.server);
    const sub = await c.post("/configurator/submissions", { answers: sampleAnswers(), idempotencyKey: idem() });
    expect((await c.get(`/configurator/estimates/${sub.body.submissionReference}?token=`)).status).toBe(404);
    const [lead] = await env.db.select().from(leads).where(eq(leads.emailNormalized, "thandi@acme.co.za"));
    expect(lead).toBeTruthy();
    void projects;
  });
});

describe("API contract", () => {
  it("documents every mounted route in OpenAPI with its validation schemas", () => {
    const doc = buildOpenApi();
    for (const r of routeRegistry) {
      const op = (doc.paths as Record<string, Record<string, { requestBody?: unknown; security?: unknown }>>)[toOpenApiPath(r.path)]?.[r.method];
      expect(op, `${r.method} ${r.path}`).toBeTruthy();
      if (r.body) expect(op.requestBody, `${r.method} ${r.path} body`).toBeTruthy();
      if (r.auth !== "public" || r.permission) expect(op.security, `${r.method} ${r.path} security`).toBeTruthy();
    }
    expect(Object.keys(doc.paths).length).toBeGreaterThan(100);
  });

  it("every admin route requires a staff permission", () => {
    const unprotected = routeRegistry.filter((r) => r.path.startsWith("/api/v1/admin/") && !r.permission);
    expect(unprotected.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });
});
