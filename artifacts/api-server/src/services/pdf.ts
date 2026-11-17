import PDFDocument from "pdfkit";
import { formatMoney } from "@workspace/domain";
import type { invoices, proposals } from "@workspace/db";

const INK = "#0F1115";
const MUTED = "#5B6271";
const RULE = "#E5E7EB";

const money = (m: number) => formatMoney(m, "ZAR", { decimals: true });
const date = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "long", year: "numeric" }).format(d) : "—";

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function header(doc: PDFKit.PDFDocument, brand: string, title: string, sub: string) {
  doc.fillColor(INK).font("Times-Roman").fontSize(20).text(brand, 50, 50);
  doc.moveTo(50, 80).lineTo(545, 80).strokeColor(RULE).stroke();
  doc.font("Times-Roman").fontSize(24).fillColor(INK).text(title, 50, 100);
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(sub, 50, 132);
  doc.moveDown(2);
}

function table(doc: PDFKit.PDFDocument, rows: { description: string; quantity: number; unitMinor: number; totalMinor: number }[]) {
  const top = doc.y + 6;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED);
  doc.text("DESCRIPTION", 50, top);
  doc.text("QTY", 340, top, { width: 40, align: "right" });
  doc.text("UNIT", 390, top, { width: 70, align: "right" });
  doc.text("AMOUNT", 470, top, { width: 75, align: "right" });
  doc.moveTo(50, top + 14).lineTo(545, top + 14).strokeColor(RULE).stroke();
  let y = top + 22;
  doc.font("Helvetica").fontSize(10).fillColor(INK);
  for (const r of rows) {
    const h = doc.heightOfString(r.description, { width: 280 });
    if (y + h > 760) {
      doc.addPage();
      y = 60;
    }
    doc.text(r.description, 50, y, { width: 280 });
    doc.text(String(r.quantity), 340, y, { width: 40, align: "right" });
    doc.text(money(r.unitMinor), 390, y, { width: 70, align: "right" });
    doc.text(money(r.totalMinor), 470, y, { width: 75, align: "right" });
    y += Math.max(h, 12) + 8;
  }
  doc.moveTo(50, y).lineTo(545, y).strokeColor(RULE).stroke();
  doc.y = y + 8;
}

function totals(doc: PDFKit.PDFDocument, items: [string, number, boolean?][]) {
  for (const [label, amount, bold] of items) {
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(bold ? INK : MUTED).text(label, 340, y, { width: 120, align: "right" });
    doc.fillColor(INK).text(money(amount), 470, y, { width: 75, align: "right" });
    doc.moveDown(0.4);
  }
}

function section(doc: PDFKit.PDFDocument, heading: string, body: string | string[]) {
  if (doc.y > 680) doc.addPage();
  doc.moveDown(1);
  doc.font("Times-Roman").fontSize(14).fillColor(INK).text(heading, 50);
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10).fillColor(MUTED);
  if (Array.isArray(body)) body.forEach((b) => doc.text(`•  ${b}`, 58, undefined, { width: 480 }));
  else doc.text(body, 50, undefined, { width: 495, lineGap: 2 });
}

export async function renderProposalPdf(p: typeof proposals.$inferSelect, brand: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `${p.reference} v${p.version} — ${p.title}`, Author: brand } });
  const done = collect(doc);
  header(doc, brand, p.title, `Proposal ${p.reference} · Version ${p.version} · Issued ${date(p.sentAt ?? p.createdAt)} · Valid until ${date(p.expiresAt)}`);
  if (p.summary) section(doc, "Summary", p.summary);
  for (const s of p.sections) section(doc, s.heading, s.body);
  section(doc, "Investment", "");
  table(doc, p.lineItems);
  const t: [string, number, boolean?][] = [["Subtotal", p.subtotalMinor]];
  if (p.taxMinor > 0) t.push([p.taxSnapshot?.label ?? "Tax", p.taxMinor]);
  t.push(["Total", p.totalMinor, true], ["Deposit on acceptance", p.depositMinor]);
  totals(doc, t);
  section(
    doc,
    "Payment schedule",
    p.milestones.map((m) => `${m.title} — ${(m.percentBps / 100).toFixed(0)}% (${money(m.amountMinor)})${m.targetOffsetDays ? `, target ~${m.targetOffsetDays} days after acceptance` : ""}`),
  );
  if (p.timelineSummary) section(doc, "Timeline", p.timelineSummary);
  if (p.assumptions.length) section(doc, "Assumptions", p.assumptions);
  if (p.exclusions.length) section(doc, "Exclusions", p.exclusions);
  if (p.terms) section(doc, "Terms", p.terms);
  if (p.acceptedAt) section(doc, "Acceptance", `Accepted electronically on ${date(p.acceptedAt)}. Content fingerprint: ${p.contentHash ?? ""}`);
  doc.end();
  return done;
}

export async function renderInvoicePdf(inv: typeof invoices.$inferSelect): Promise<Buffer> {
  const issuer = inv.issuerSnapshot as { tradingName?: string; legalName?: string; registrationNumber?: string; email?: string; address?: string[]; vatNumber?: string | null; eft?: Record<string, string> };
  const billing = inv.billingSnapshot as { name?: string; vatNumber?: string | null; email?: string | null };
  const brand = issuer.tradingName ?? "Operandis";
  const taxInvoice = inv.taxSnapshot.enabled && issuer.vatNumber;
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `Invoice ${inv.number}`, Author: brand } });
  const done = collect(doc);
  header(doc, brand, taxInvoice ? "Tax invoice" : "Invoice", `${inv.number} · Issued ${date(inv.issuedAt)} · Due ${date(inv.dueAt)} · Status: ${inv.status.replace("_", " ")}`);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("FROM", 50, doc.y);
  doc.font("Helvetica").fontSize(10).fillColor(INK).text([issuer.legalName, issuer.registrationNumber ? `Reg. ${issuer.registrationNumber}` : null, ...(issuer.address ?? []), issuer.email, issuer.vatNumber ? `VAT ${issuer.vatNumber}` : null].filter(Boolean).join("\n"), 50, undefined, { width: 230 });
  const y = 175;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text("BILL TO", 320, y);
  doc.font("Helvetica").fontSize(10).fillColor(INK).text([billing.name, billing.email, billing.vatNumber ? `VAT ${billing.vatNumber}` : null].filter(Boolean).join("\n"), 320, undefined, { width: 225 });
  doc.y = Math.max(doc.y, 270);
  table(doc, inv.lines);
  const t: [string, number, boolean?][] = [["Subtotal", inv.subtotalMinor]];
  if (inv.taxMinor > 0) t.push([inv.taxSnapshot.label, inv.taxMinor]);
  t.push(["Total", inv.totalMinor, true], ["Paid", inv.amountPaidMinor]);
  if (inv.amountRefundedMinor > 0) t.push(["Refunded", inv.amountRefundedMinor]);
  t.push(["Balance due", inv.status === "void" ? 0 : Math.max(0, inv.totalMinor - inv.amountPaidMinor), true]);
  totals(doc, t);
  if (issuer.eft?.accountNumber) {
    section(doc, "Pay by EFT", [`${issuer.eft.bankName} · ${issuer.eft.accountName}`, `Account ${issuer.eft.accountNumber} · Branch ${issuer.eft.branchCode} · ${issuer.eft.accountType}`, `Reference: ${inv.number}`]);
  }
  if (inv.notes) section(doc, "Notes", inv.notes);
  if (inv.status === "void") section(doc, "Void", `This invoice was voided${inv.voidReason ? `: ${inv.voidReason}` : "."}`);
  doc.end();
  return done;
}
