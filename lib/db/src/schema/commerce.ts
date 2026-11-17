import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { InvoiceStatus, OrderStatus, PaymentAttemptStatus, ProposalStatus } from "@workspace/domain";
import { createdAt, id, minor, ts, updatedAt } from "./common";
import { organizations, users, type Address } from "./identity";
import { leads, configuratorSubmissions, estimates } from "./crm";
import { packages } from "./catalogue";

/** Concurrency-safe, gapless document numbering (row-locked counter per key, e.g. "INV-2026"). */
export const numberSequences = pgTable("number_sequences", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
});

export interface ProposalSection {
  heading: string;
  body: string;
}
export interface ProposalLineItem {
  description: string;
  quantity: number;
  unitMinor: number;
  totalMinor: number;
}
export interface ProposalMilestone {
  key: string;
  title: string;
  description: string;
  percentBps: number;
  amountMinor: number;
  /** Days after acceptance the milestone is targeted for. */
  targetOffsetDays: number;
  /** The milestone invoiced on acceptance. */
  isDeposit?: boolean;
}

export const proposals = pgTable(
  "proposals",
  {
    id: id(),
    /** All versions of one proposal share a group id; each version is its own immutable row once sent. */
    groupId: uuid("group_id").notNull(),
    reference: text("reference").notNull(),
    version: integer("version").notNull().default(1),
    leadId: uuid("lead_id").references(() => leads.id),
    organizationId: uuid("organization_id").references(() => organizations.id),
    submissionId: uuid("submission_id").references(() => configuratorSubmissions.id),
    estimateId: uuid("estimate_id").references(() => estimates.id),
    status: text("status").$type<ProposalStatus>().notNull().default("draft"),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    sections: jsonb("sections").$type<ProposalSection[]>().notNull().default([]),
    lineItems: jsonb("line_items").$type<ProposalLineItem[]>().notNull().default([]),
    assumptions: jsonb("assumptions").$type<string[]>().notNull().default([]),
    exclusions: jsonb("exclusions").$type<string[]>().notNull().default([]),
    milestones: jsonb("milestones").$type<ProposalMilestone[]>().notNull().default([]),
    timelineSummary: text("timeline_summary").notNull().default(""),
    terms: text("terms").notNull().default(""),
    currency: text("currency").$type<"ZAR">().notNull().default("ZAR"),
    subtotalMinor: minor("subtotal_minor").notNull().default(0),
    taxMinor: minor("tax_minor").notNull().default(0),
    totalMinor: minor("total_minor").notNull().default(0),
    depositMinor: minor("deposit_minor").notNull().default(0),
    taxSnapshot: jsonb("tax_snapshot").$type<{ enabled: boolean; rateBps: number; label: string; pricesIncludeTax: boolean }>(),
    expiresAt: ts("expires_at"),
    sentAt: ts("sent_at"),
    viewedAt: ts("viewed_at"),
    acceptedAt: ts("accepted_at"),
    acceptedById: uuid("accepted_by_id").references(() => users.id),
    acceptedIp: text("accepted_ip"),
    /** SHA-256 of the canonical commercial snapshot the client accepted. */
    contentHash: text("content_hash"),
    declinedAt: ts("declined_at"),
    declineReason: text("decline_reason"),
    rowVersion: integer("row_version").notNull().default(1),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("proposals_group_version_uq").on(t.groupId, t.version),
    index("proposals_org_idx").on(t.organizationId),
    index("proposals_lead_idx").on(t.leadId),
    index("proposals_status_idx").on(t.status),
  ],
);

export type OrderSource = "package" | "proposal" | "discovery";

export const orders = pgTable(
  "orders",
  {
    id: id(),
    reference: text("reference").notNull().unique(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").references(() => users.id),
    leadId: uuid("lead_id").references(() => leads.id),
    source: text("source").$type<OrderSource>().notNull(),
    packageId: uuid("package_id").references(() => packages.id),
    packageVersion: integer("package_version"),
    proposalId: uuid("proposal_id").references(() => proposals.id),
    submissionId: uuid("submission_id").references(() => configuratorSubmissions.id),
    status: text("status").$type<OrderStatus>().notNull().default("pending_payment"),
    currency: text("currency").$type<"ZAR">().notNull().default("ZAR"),
    subtotalMinor: minor("subtotal_minor").notNull(),
    taxMinor: minor("tax_minor").notNull().default(0),
    totalMinor: minor("total_minor").notNull(),
    depositMinor: minor("deposit_minor").notNull().default(0),
    billingDetails: jsonb("billing_details").$type<{ name: string; email: string; phone?: string; company?: string; vatNumber?: string; address?: Address }>().notNull(),
    termsAcceptedAt: ts("terms_accepted_at"),
    termsVersion: text("terms_version"),
    /** Immutable snapshot of the package/proposal and price as purchased. */
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    notes: text("notes").notNull().default(""),
    cancelledAt: ts("cancelled_at"),
    confirmedAt: ts("confirmed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("orders_org_idx").on(t.organizationId), index("orders_status_idx").on(t.status, t.createdAt)],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"package" | "variant" | "option" | "line" | "discovery">().notNull(),
    key: text("key"),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitMinor: minor("unit_minor").notNull(),
    totalMinor: minor("total_minor").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

export type InvoiceKind = "deposit" | "milestone" | "full" | "balance" | "retainer" | "discovery" | "other";
export interface InvoiceLine {
  description: string;
  quantity: number;
  unitMinor: number;
  totalMinor: number;
}

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    number: text("number").notNull(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    orderId: uuid("order_id").references(() => orders.id),
    projectId: uuid("project_id"),
    milestoneId: uuid("milestone_id"),
    kind: text("kind").$type<InvoiceKind>().notNull(),
    status: text("status").$type<InvoiceStatus>().notNull().default("issued"),
    currency: text("currency").$type<"ZAR">().notNull().default("ZAR"),
    lines: jsonb("lines").$type<InvoiceLine[]>().notNull(),
    subtotalMinor: minor("subtotal_minor").notNull(),
    taxMinor: minor("tax_minor").notNull().default(0),
    totalMinor: minor("total_minor").notNull(),
    amountPaidMinor: minor("amount_paid_minor").notNull().default(0),
    amountRefundedMinor: minor("amount_refunded_minor").notNull().default(0),
    taxSnapshot: jsonb("tax_snapshot").$type<{ enabled: boolean; rateBps: number; label: string; pricesIncludeTax: boolean; vatNumber?: string | null }>().notNull(),
    billingSnapshot: jsonb("billing_snapshot").$type<Record<string, unknown>>().notNull(),
    issuerSnapshot: jsonb("issuer_snapshot").$type<Record<string, unknown>>().notNull(),
    notes: text("notes").notNull().default(""),
    issuedAt: ts("issued_at"),
    dueAt: ts("due_at"),
    paidAt: ts("paid_at"),
    voidedAt: ts("voided_at"),
    voidReason: text("void_reason"),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("invoices_number_uq").on(t.number),
    index("invoices_org_idx").on(t.organizationId),
    index("invoices_status_idx").on(t.status, t.dueAt),
    index("invoices_order_idx").on(t.orderId),
  ],
);

export type PaymentProvider = "payfast" | "yoco" | "eft";

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: id(),
    /** Merchant reference sent to the provider (m_payment_id / metadata). */
    reference: text("reference").notNull(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    orderId: uuid("order_id").references(() => orders.id),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    provider: text("provider").$type<PaymentProvider>().notNull(),
    status: text("status").$type<PaymentAttemptStatus>().notNull().default("created"),
    purpose: text("purpose").$type<"checkout" | "invoice">().notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").$type<"ZAR">().notNull().default("ZAR"),
    idempotencyKey: text("idempotency_key").notNull(),
    providerCheckoutId: text("provider_checkout_id"),
    redirectUrl: text("redirect_url"),
    failureReason: text("failure_reason"),
    proofFileId: uuid("proof_file_id"),
    createdById: uuid("created_by_id").references(() => users.id),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payment_attempts_reference_uq").on(t.reference),
    uniqueIndex("payment_attempts_idem_uq").on(t.idempotencyKey),
    index("payment_attempts_invoice_idx").on(t.invoiceId),
    index("payment_attempts_order_idx").on(t.orderId),
  ],
);

export const paymentTransactions = pgTable(
  "payment_transactions",
  {
    id: id(),
    attemptId: uuid("attempt_id").references(() => paymentAttempts.id),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    provider: text("provider").$type<PaymentProvider>().notNull(),
    providerTransactionId: text("provider_transaction_id").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    feeMinor: minor("fee_minor"),
    netMinor: minor("net_minor"),
    currency: text("currency").$type<"ZAR">().notNull().default("ZAR"),
    status: text("status").$type<"succeeded" | "reversed">().notNull().default("succeeded"),
    refundedMinor: minor("refunded_minor").notNull().default(0),
    verifiedAt: ts("verified_at").notNull(),
    verifiedById: uuid("verified_by_id").references(() => users.id),
    verificationMethod: text("verification_method").$type<"webhook" | "api_reconciliation" | "manual_eft">().notNull(),
    disputeStatus: text("dispute_status"),
    rawRedacted: jsonb("raw_redacted").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("payment_tx_provider_uq").on(t.provider, t.providerTransactionId),
    index("payment_tx_invoice_idx").on(t.invoiceId),
  ],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").$type<PaymentProvider>().notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    providerReference: text("provider_reference"),
    signatureValid: boolean("signature_valid").notNull(),
    processingStatus: text("processing_status").$type<"received" | "processed" | "ignored" | "failed" | "rejected">().notNull().default("received"),
    result: text("result"),
    error: text("error"),
    retryCount: integer("retry_count").notNull().default(0),
    payloadRedacted: jsonb("payload_redacted").$type<Record<string, unknown>>().notNull().default({}),
    sourceIp: text("source_ip"),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
  },
  (t) => [uniqueIndex("webhook_events_provider_event_uq").on(t.provider, t.eventId), index("webhook_events_received_idx").on(t.receivedAt)],
);

export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    transactionId: uuid("transaction_id").notNull().references(() => paymentTransactions.id),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").$type<"ZAR">().notNull().default("ZAR"),
    reason: text("reason").notNull(),
    status: text("status").$type<"pending" | "succeeded" | "failed" | "manual_pending" | "manual_completed">().notNull().default("pending"),
    providerRefundId: text("provider_refund_id"),
    failureReason: text("failure_reason"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdById: uuid("created_by_id").notNull().references(() => users.id),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("refunds_tx_idx").on(t.transactionId)],
);

export const creditNotes = pgTable("credit_notes", {
  id: id(),
  number: text("number").notNull().unique(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  refundId: uuid("refund_id").references(() => refunds.id),
  amountMinor: minor("amount_minor").notNull(),
  reason: text("reason").notNull(),
  issuedAt: ts("issued_at").notNull().defaultNow(),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: createdAt(),
});
