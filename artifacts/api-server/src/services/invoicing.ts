import { eq } from "drizzle-orm";
import { invoices, organizations, type DbOrTx, type InvoiceKind, type InvoiceLine } from "@workspace/db";
import { computeTax, sumMinor, type TaxConfig } from "@workspace/domain";
import { addDays, nextNumber } from "../lib/db-helpers";
import type { AppContext } from "../context";

export type InvoiceAmounts =
  | { mode: "net"; lines: { description: string; quantity: number; unitMinor: number }[] }
  /** A tax-inclusive amount (e.g. a deposit computed from a tax-inclusive contract value). */
  | { mode: "gross"; description: string; grossMinor: number };

export interface IssueInvoiceInput {
  organizationId: string;
  orderId?: string | null;
  projectId?: string | null;
  milestoneId?: string | null;
  kind: InvoiceKind;
  amounts: InvoiceAmounts;
  dueInDays?: number;
  notes?: string;
  createdById?: string | null;
  /** Use a frozen tax config (e.g. from an accepted proposal) instead of current settings. */
  tax?: TaxConfig & { vatNumber?: string | null };
  /** Mark as already paid (receipt for a verified gateway payment). */
  paidAt?: Date | null;
  issuedAt?: Date;
}

/** Issue an invoice with a concurrency-safe number and immutable tax/billing/issuer snapshots. */
export async function issueInvoice(app: AppContext, tx: DbOrTx, input: IssueInvoiceInput) {
  const tax = input.tax ?? (await app.settings.tax(tx));
  const business = await app.settings.get("business", tx);
  const commerce = await app.settings.get("commerce", tx);
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, input.organizationId));

  let lines: InvoiceLine[];
  let subtotal: number;
  let taxMinor: number;
  let total: number;
  if (input.amounts.mode === "net") {
    lines = input.amounts.lines.map((l) => ({ ...l, totalMinor: l.unitMinor * l.quantity }));
    const net = sumMinor(lines.map((l) => l.totalMinor));
    const t = computeTax(net, { ...tax, pricesIncludeTax: false });
    subtotal = t.subtotalMinor;
    taxMinor = t.taxMinor;
    total = t.totalMinor;
  } else {
    const t = computeTax(input.amounts.grossMinor, { ...tax, pricesIncludeTax: true });
    subtotal = t.subtotalMinor;
    taxMinor = t.taxMinor;
    total = t.totalMinor;
    lines = [{ description: input.amounts.description, quantity: 1, unitMinor: subtotal, totalMinor: subtotal }];
  }

  const issuedAt = input.issuedAt ?? new Date();
  const number = await nextNumber(tx, "INV", issuedAt);
  const paid = Boolean(input.paidAt);
  const [inv] = await tx
    .insert(invoices)
    .values({
      number,
      organizationId: input.organizationId,
      orderId: input.orderId ?? null,
      projectId: input.projectId ?? null,
      milestoneId: input.milestoneId ?? null,
      kind: input.kind,
      status: paid ? "paid" : "issued",
      lines,
      subtotalMinor: subtotal,
      taxMinor,
      totalMinor: total,
      amountPaidMinor: paid ? total : 0,
      taxSnapshot: { enabled: tax.enabled, rateBps: tax.rateBps, label: tax.label, pricesIncludeTax: tax.pricesIncludeTax, vatNumber: tax.vatNumber ?? null },
      billingSnapshot: org
        ? { name: org.name, vatNumber: org.vatNumber, registrationNumber: org.registrationNumber, email: org.billingEmail, address: org.billingAddress }
        : {},
      issuerSnapshot: {
        tradingName: business.tradingName,
        legalName: business.legalName,
        registrationNumber: business.registrationNumber,
        email: business.email,
        address: business.address,
        vatNumber: tax.enabled ? (tax.vatNumber ?? null) : null,
        eft: commerce.eft,
      },
      notes: input.notes ?? "",
      issuedAt,
      dueAt: addDays(issuedAt, input.dueInDays ?? commerce.invoiceDueDays),
      paidAt: input.paidAt ?? null,
      createdById: input.createdById ?? null,
    })
    .returning();
  return inv;
}

export function invoiceBalance(inv: { totalMinor: number; amountPaidMinor: number; status: string }) {
  if (inv.status === "void") return 0;
  return Math.max(0, inv.totalMinor - inv.amountPaidMinor);
}

export function isOverdue(inv: { status: string; dueAt: Date | null; totalMinor: number; amountPaidMinor: number }, now = new Date()) {
  return ["issued", "partially_paid"].includes(inv.status) && inv.dueAt !== null && inv.dueAt < now && invoiceBalance(inv) > 0;
}
