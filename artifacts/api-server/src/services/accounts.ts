import type { Request, Response } from "express";
import { and, eq, gt, isNull, inArray } from "drizzle-orm";
import { authTokens, organizationMembers, organizations, sessions, users, type AuthTokenType, type DbOrTx } from "@workspace/db";
import { isStaffRole } from "@workspace/domain";
import { randomToken, sha256 } from "../lib/crypto";
import { badRequest, notFound } from "../lib/errors";
import { normalizeEmail } from "../lib/db-helpers";
import { cookieOptions, SESSION_COOKIE } from "../middleware/session";
import type { AppContext } from "../context";

export const TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  verify_email: 48 * 3600_000,
  password_reset: 3600_000,
  magic_link: 30 * 60_000,
  invite: 7 * 24 * 3600_000,
};

export async function createAuthToken(tx: DbOrTx, userId: string, type: AuthTokenType): Promise<string> {
  const raw = randomToken(32);
  await tx.insert(authTokens).values({ userId, type, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + TOKEN_TTL_MS[type]) });
  return raw;
}

/** Single-use: marks the token used atomically and returns the user id. */
export async function consumeAuthToken(tx: DbOrTx, raw: string, types: AuthTokenType[]): Promise<{ userId: string; type: AuthTokenType }> {
  const rows = await tx
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.tokenHash, sha256(raw)), inArray(authTokens.type, types), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .returning({ userId: authTokens.userId, type: authTokens.type });
  if (!rows[0]) throw badRequest("This link is invalid or has expired. Request a new one.");
  return rows[0];
}

export async function createSession(app: AppContext, req: Request, res: Response, userId: string, opts: { mfaVerified: boolean }) {
  const security = await app.settings.security();
  const raw = randomToken(32);
  const ttl = security.sessionDays * 86_400_000;
  const [session] = await app.db.insert(sessions).values({
    tokenHash: sha256(raw),
    userId,
    mfaVerified: opts.mfaVerified,
    ip: req.ip ?? null,
    userAgent: (req.get("user-agent") ?? "").slice(0, 300),
    expiresAt: new Date(Date.now() + ttl),
  }).returning();
  await app.db.update(users).set({ lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, userId));
  res.cookie(SESSION_COOKIE, raw, cookieOptions(app, ttl));
  return session;
}

export async function revokeSession(app: AppContext, sessionId: string) {
  await app.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeAllSessions(tx: DbOrTx, userId: string) {
  await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function userOrganizationIds(tx: DbOrTx, userId: string): Promise<string[]> {
  const rows = await tx.select({ id: organizationMembers.organizationId }).from(organizationMembers).where(eq(organizationMembers.userId, userId));
  return rows.map((r) => r.id);
}

/** Throws 404 (not 403) when the user is not a member — no existence leak. */
export async function assertOrgAccess(tx: DbOrTx, userId: string, organizationId: string | null | undefined, what = "Resource") {
  if (!organizationId) throw notFound(what);
  const rows = await tx
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.organizationId, organizationId)));
  if (!rows[0]) throw notFound(what);
}

export interface ClientIdentity {
  email: string;
  name: string;
  phone?: string | null;
  company?: string | null;
}

/**
 * Find or create the client user + organisation for a guest purchase, enquiry or proposal.
 * Individuals get a personal organisation so ownership is always org-based.
 */
export async function findOrCreateClient(tx: DbOrTx, identity: ClientIdentity): Promise<{ userId: string; organizationId: string; created: boolean; hasPassword: boolean; role: string }> {
  const emailNormalized = normalizeEmail(identity.email);
  const existing = await tx.select().from(users).where(eq(users.emailNormalized, emailNormalized));
  if (existing[0]) {
    const u = existing[0];
    const orgs = await userOrganizationIds(tx, u.id);
    let organizationId = orgs[0];
    if (!organizationId) organizationId = await createOrgFor(tx, u.id, identity);
    return { userId: u.id, organizationId, created: false, hasPassword: Boolean(u.passwordHash), role: u.role };
  }
  const [user] = await tx
    .insert(users)
    .values({ email: identity.email.trim(), emailNormalized, name: identity.name.trim(), phone: identity.phone ?? null, role: "client" })
    .returning({ id: users.id });
  const organizationId = await createOrgFor(tx, user.id, identity);
  return { userId: user.id, organizationId, created: true, hasPassword: false, role: "client" };
}

async function createOrgFor(tx: DbOrTx, userId: string, identity: ClientIdentity): Promise<string> {
  const company = identity.company?.trim();
  const [org] = await tx
    .insert(organizations)
    .values({ name: company || identity.name.trim(), kind: company ? "company" : "individual", billingEmail: identity.email.trim() })
    .returning({ id: organizations.id });
  await tx.insert(organizationMembers).values({ organizationId: org.id, userId, role: "owner" });
  return org.id;
}

export function isStaff(role: string): boolean {
  return isStaffRole(role as never);
}
