import { index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, ts } from "./common";
import { users } from "./identity";

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    toEmail: text("to_email"),
    channel: text("channel").$type<"email" | "in_app">().notNull(),
    template: text("template").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<"queued" | "sent" | "failed" | "skipped">().notNull().default("queued"),
    error: text("error"),
    providerMessageId: text("provider_message_id"),
    /** Prevents duplicate notifications (e.g. on duplicate webhooks). */
    dedupeKey: text("dedupe_key").unique(),
    attempts: integer("attempts").notNull().default(0),
    sentAt: ts("sent_at"),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.channel, t.createdAt), index("notifications_status_idx").on(t.status)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Append-only. A migration adds a trigger that rejects UPDATE/DELETE. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    actorId: uuid("actor_id"),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before").$type<unknown>(),
    after: jsonb("after").$type<unknown>(),
    reason: text("reason"),
    ip: text("ip"),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_created_idx").on(t.createdAt), index("audit_actor_idx").on(t.actorId)],
);

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: id(),
    name: text("name").notNull(),
    /** Random per-browser id (only sent after analytics consent) or "server". */
    anonymousId: text("anonymous_id"),
    userId: uuid("user_id"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    properties: jsonb("properties").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("analytics_name_idx").on(t.name, t.createdAt)],
);
