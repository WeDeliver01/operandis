import crypto from "node:crypto";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const API = "http://localhost:5055/api/v1";
const PASSPHRASE = "jt7NOE43FZPn";

/** Build a PayFast ITN exactly as PayFast's sandbox would post it (ordered + MD5 signature). */
function itn(fields: { m_payment_id: string; amount_gross: string; pf_payment_id: string; payment_status?: string }) {
  const pairs: [string, string][] = [
    ["m_payment_id", fields.m_payment_id],
    ["pf_payment_id", fields.pf_payment_id],
    ["payment_status", fields.payment_status ?? "COMPLETE"],
    ["item_name", "E2E"],
    ["amount_gross", fields.amount_gross],
    ["amount_fee", "-10.00"],
    ["amount_net", (Number(fields.amount_gross) - 10).toFixed(2)],
    ["merchant_id", "10000100"],
  ];
  const enc = (v: string) => encodeURIComponent(v).replace(/%20/g, "+");
  const sig = crypto.createHash("md5").update(`${pairs.map(([k, v]) => `${k}=${enc(v)}`).join("&")}&passphrase=${enc(PASSPHRASE)}`).digest("hex");
  return `${pairs.map(([k, v]) => `${k}=${enc(v)}`).join("&")}&signature=${sig}`;
}

/**
 * Stand in for PayFast's hosted page: capture the signed form the site posts,
 * send the shopper back to return_url, and return the fields so the test can
 * deliver the server-to-server ITN.
 */
async function interceptPayFast(page: Page) {
  let captured: Record<string, string> | null = null;
  await page.route("https://sandbox.payfast.co.za/**", async (route) => {
    captured = Object.fromEntries(new URLSearchParams(route.request().postData() ?? ""));
    await route.fulfill({ status: 302, headers: { location: captured.return_url } });
  });
  return () => captured;
}

async function deliverItn(request: APIRequestContext, fields: Record<string, string>, pfId: string) {
  const res = await request.post(`${API}/webhooks/payments/payfast`, {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    data: itn({ m_payment_id: fields.m_payment_id, amount_gross: fields.amount, pf_payment_id: pfId }),
  });
  expect(res.status()).toBe(200);
  expect((await res.json()).status).toBe("processed");
}

async function dismissCookies(page: Page) {
  const btn = page.getByRole("button", { name: "Reject non-essential" });
  if (await btn.isVisible().catch(() => false)) await btn.click();
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await dismissCookies(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("brief → estimate → admin proposal → client acceptance → deposit paid → work starts", async ({ browser, request }) => {
  const clientEmail = `client-${Date.now()}@e2e.test`;

  // ---------------------------------------------------------------- visitor configures a project
  const visitor = await browser.newPage();
  await visitor.goto("/");
  await dismissCookies(visitor);
  await visitor.getByRole("link", { name: "Configure a project" }).first().click();
  await expect(visitor.getByRole("heading", { name: "Tell us about you" })).toBeVisible();
  await visitor.getByLabel("Your name").fill("Thandi Mokoena");
  await visitor.getByLabel("Email").fill(clientEmail);
  await visitor.getByLabel("Company").fill("Mokoena Logistics");
  await visitor.getByRole("button", { name: "Continue" }).click();

  await visitor.getByLabel("Describe the problem").fill("Dispatch runs on three spreadsheets and a WhatsApp group, and we lose orders every week.");
  await visitor.getByRole("button", { name: "Continue" }).click();
  await visitor.getByLabel(/Internal business system/).check();
  await visitor.getByRole("button", { name: "Continue" }).click();
  await visitor.getByLabel("Your team members using it").selectOption({ label: "11–50" });
  await visitor.getByLabel("Customers or external users").selectOption({ label: "None" });
  await visitor.getByLabel("Different types of user").selectOption({ label: "2–3 roles" });
  await visitor.getByRole("button", { name: "Continue" }).click();
  await visitor.getByLabel(/Dashboards & reporting/).check();
  await visitor.getByRole("button", { name: "Continue" }).click();
  await visitor.getByRole("button", { name: "Continue" }).click(); // integrations: none
  await visitor.getByLabel(/Logo\/brand only/).check();
  await visitor.getByRole("button", { name: "Continue" }).click();
  await visitor.getByRole("button", { name: "Continue" }).click(); // migration: starting fresh
  await visitor.getByLabel(/R150 000 – R400 000/).check();
  await visitor.getByLabel("When would you like to launch?").selectOption({ label: "3–6 months" });
  await visitor.getByRole("button", { name: "Continue" }).click();
  await expect(visitor.getByRole("heading", { name: "Review your brief" })).toBeVisible();
  await visitor.getByLabel(/I consent to Operandis processing this brief/).check();
  await visitor.getByRole("button", { name: "Get my assessment" }).click();
  await expect(visitor.getByText("Indicative investment")).toBeVisible();
  await expect(visitor.getByText(/non-binding/).first()).toBeVisible();
  const reference = (await visitor.getByText(/BRF-\d{4}-\d{5}/).first().textContent())!.match(/BRF-\d{4}-\d{5}/)![0];

  // ---------------------------------------------------------------- staff review → proposal
  const admin = await browser.newPage();
  await login(admin, "owner@e2e.test");
  await expect(admin.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await admin.goto("/admin/submissions");
  await admin.getByRole("link", { name: reference }).click();
  await admin.getByRole("button", { name: "Draft proposal from brief" }).click();
  await expect(admin.getByText(/version 1/)).toBeVisible();
  await admin.getByRole("button", { name: "Send to client" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Send to client" }).click();
  await expect(admin.getByText("sent", { exact: true }).first()).toBeVisible();

  // ---------------------------------------------------------------- client signs in via emailed link and accepts
  const outbox = await (await request.get(`${API}/dev/outbox?to=${encodeURIComponent(clientEmail)}`)).json();
  const proposalMail = outbox.find((m: { subject: string }) => m.subject.startsWith("Proposal"));
  expect(proposalMail).toBeTruthy();
  const link = proposalMail.text.match(/https?:\/\/\S+\/auth\/magic\?\S+/)![0];
  const clientPage = await browser.newPage();
  await clientPage.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await dismissCookies(clientPage);
  await expect(clientPage.getByText("Set a password (optional)")).toBeVisible();
  await clientPage.getByRole("link", { name: "continue" }).click();
  await expect(clientPage.getByRole("button", { name: "Accept proposal" })).toBeVisible();
  await clientPage.getByLabel(/I've read version 1 of this proposal/).check();
  const getFields = await interceptPayFast(clientPage);
  await clientPage.getByRole("button", { name: "Accept proposal" }).click();

  // Lands on the deposit invoice.
  await expect(clientPage.getByRole("heading", { name: /Invoice INV-/ })).toBeVisible();
  await clientPage.getByRole("button", { name: /Pay with/ }).click();
  await expect.poll(() => getFields()).not.toBeNull();
  await deliverItn(request, getFields()!, `E2E-${Date.now()}`);
  await expect(clientPage.getByText("Paid in full")).toBeVisible({ timeout: 15_000 });

  // ---------------------------------------------------------------- staff can now start work; client sees it
  await admin.goto("/admin/projects");
  await admin.getByRole("link", { name: /for Mokoena Logistics/ }).click();
  await expect(admin.getByText("Deposit not yet paid")).toHaveCount(0);
  await admin.getByLabel("Status", { exact: true }).selectOption({ label: "In progress" });
  await expect(admin.getByLabel("Status", { exact: true })).toHaveValue("in_progress");

  await clientPage.goto("/portal/projects");
  await expect(clientPage.getByText("In progress").first()).toBeVisible();
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test("buys a package on a phone; the order is confirmed only by the verified ITN", async ({ page, request }) => {
    await page.goto("/packages/business-website");
    await dismissCookies(page);
    await expect(page.getByRole("heading", { name: "Business website" })).toBeVisible();
    await page.getByLabel(/Copywriting/).check();
    await expect(page.getByText("R 38 000").first()).toBeVisible();
    await page.getByRole("button", { name: "Continue to checkout" }).click();
    await page.getByLabel("Full name").fill("Sipho Ndlovu");
    await page.getByLabel("Email").fill(`buyer-${Date.now()}@e2e.test`);
    await page.getByLabel(/Card \/ Instant EFT/).check();
    await page.getByLabel(/I accept the package scope/).check();
    const getFields = await interceptPayFast(page);
    await page.getByRole("button", { name: /Pay securely/ }).click();
    await expect.poll(() => getFields()).not.toBeNull();
    const fields = getFields()!;
    expect(fields.amount).toBe("19000.00");

    // Back from the gateway: the redirect alone must not confirm anything.
    await expect(page.getByRole("heading", { name: "Confirming your payment…" })).toBeVisible();
    await deliverItn(request, fields, `E2E-M-${Date.now()}`);
    await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible({ timeout: 15_000 });
  });
});
