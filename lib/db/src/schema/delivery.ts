import { boolean, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import type { ChangeRequestStatus, MilestoneStatus, ProjectStatus } from "@workspace/domain";
import { createdAt, id, minor, ts, updatedAt } from "./common";
import { organizations, users } from "./identity";
import { orders, proposals, invoices } from "./commerce";

export const projects = pgTable(
  "projects",
  {
    id: id(),
    reference: text("reference").notNull().unique(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    orderId: uuid("order_id").references(() => orders.id),
    proposalId: uuid("proposal_id").references(() => proposals.id),
    name: text("name").notNull(),
    summary: text("summary").notNull().default(""),
    status: text("status").$type<ProjectStatus>().notNull().default("awaiting_deposit"),
    managerId: uuid("manager_id").references(() => users.id, { onDelete: "set null" }),
    contractValueMinor: minor("contract_value_minor").notNull().default(0),
    depositRequired: boolean("deposit_required").notNull().default(true),
    depositInvoiceId: uuid("deposit_invoice_id"),
    depositPaidAt: ts("deposit_paid_at"),
    depositExceptionReason: text("deposit_exception_reason"),
    depositExceptionById: uuid("deposit_exception_by_id").references(() => users.id),
    progressPct: integer("progress_pct").notNull().default(0),
    startDate: ts("start_date"),
    targetDate: ts("target_date"),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("projects_org_idx").on(t.organizationId), index("projects_status_idx").on(t.status), index("projects_manager_idx").on(t.managerId)],
);

export const milestones = pgTable(
  "milestones",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").$type<MilestoneStatus>().notNull().default("pending"),
    displayOrder: integer("display_order").notNull().default(0),
    amountMinor: minor("amount_minor").notNull().default(0),
    /** Whether reaching this milestone triggers a payment (invoice). */
    billable: boolean("billable").notNull().default(false),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    visibility: text("visibility").$type<"client" | "internal">().notNull().default("client"),
    targetDate: ts("target_date"),
    completedAt: ts("completed_at"),
    clientApprovedAt: ts("client_approved_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("milestones_project_idx").on(t.projectId, t.displayOrder)],
);

export type FileKind = "deliverable" | "document" | "client_upload" | "eft_proof" | "proposal_attachment";

export const projectFiles = pgTable(
  "project_files",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    projectId: uuid("project_id").references(() => projects.id),
    uploaderId: uuid("uploader_id").references(() => users.id),
    objectKey: text("object_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    kind: text("kind").$type<FileKind>().notNull(),
    visibility: text("visibility").$type<"client" | "internal">().notNull().default("client"),
    description: text("description").notNull().default(""),
    approvedAt: ts("approved_at"),
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
  },
  (t) => [index("project_files_project_idx").on(t.projectId), index("project_files_org_idx").on(t.organizationId)],
);

export const changeRequests = pgTable(
  "change_requests",
  {
    id: id(),
    reference: text("reference").notNull().unique(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    submittedById: uuid("submitted_by_id").references(() => users.id),
    type: text("type").$type<"defect" | "change" | "support" | "question">().notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    priority: text("priority").$type<"low" | "normal" | "high" | "urgent">().notNull().default("normal"),
    status: text("status").$type<ChangeRequestStatus>().notNull().default("open"),
    /** New-scope changes are quoted; defects are not billable. */
    impactEstimateMinor: minor("impact_estimate_minor"),
    impactDays: integer("impact_days"),
    response: text("response").notNull().default(""),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    clientDecisionAt: ts("client_decision_at"),
    resolvedAt: ts("resolved_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("change_requests_project_idx").on(t.projectId), index("change_requests_status_idx").on(t.status)],
);

export type ThreadType = "project" | "proposal" | "change_request" | "lead";

export const messages = pgTable(
  "messages",
  {
    id: id(),
    threadType: text("thread_type").$type<ThreadType>().notNull(),
    threadId: uuid("thread_id").notNull(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").$type<"message" | "update" | "system">().notNull().default("message"),
    body: text("body").notNull(),
    /** Internal notes are never returned to clients. */
    internal: boolean("internal").notNull().default(false),
    attachments: jsonb("attachments").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("messages_thread_idx").on(t.threadType, t.threadId, t.createdAt)],
);
