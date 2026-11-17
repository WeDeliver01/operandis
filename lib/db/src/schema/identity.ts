import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { Role } from "@workspace/domain";
import { createdAt, id, ts, updatedAt } from "./common";

export interface NotificationPrefs {
  emailProjectUpdates: boolean;
  emailInvoices: boolean;
  emailMarketing: boolean;
}

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    name: text("name").notNull().default(""),
    phone: text("phone"),
    passwordHash: text("password_hash"),
    role: text("role").$type<Role>().notNull().default("client"),
    status: text("status").$type<"active" | "disabled">().notNull().default("active"),
    emailVerifiedAt: ts("email_verified_at"),
    mfaSecret: text("mfa_secret"),
    mfaEnabledAt: ts("mfa_enabled_at"),
    lastLoginAt: ts("last_login_at"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: ts("locked_until"),
    notificationPrefs: jsonb("notification_prefs").$type<NotificationPrefs>().notNull().default({ emailProjectUpdates: true, emailInvoices: true, emailMarketing: false }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_normalized_uq").on(t.emailNormalized), index("users_role_idx").on(t.role)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    mfaVerified: boolean("mfa_verified").notNull().default(false),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("sessions_token_hash_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export type AuthTokenType = "verify_email" | "password_reset" | "magic_link" | "invite";

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AuthTokenType>().notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("auth_tokens_hash_uq").on(t.tokenHash), index("auth_tokens_user_idx").on(t.userId, t.type)],
);

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
}

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  kind: text("kind").$type<"company" | "individual">().notNull().default("company"),
  registrationNumber: text("registration_number"),
  vatNumber: text("vat_number"),
  industry: text("industry"),
  billingEmail: text("billing_email"),
  billingAddress: jsonb("billing_address").$type<Address>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"owner" | "member" | "billing">().notNull().default("owner"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("org_members_uq").on(t.organizationId, t.userId), index("org_members_user_idx").on(t.userId)],
);
