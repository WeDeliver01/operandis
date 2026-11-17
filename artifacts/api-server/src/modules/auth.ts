import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { organizationMembers, organizations, users, sessions } from "@workspace/db";
import { ROLE_PERMISSIONS, isStaffRole } from "@workspace/domain";
import {
  changePasswordBody,
  emailOnlyBody,
  loginBody,
  meSchema,
  mfaCodeBody,
  registerBody,
  resetPasswordBody,
  tokenBody,
  updateProfileBody,
  okSchema,
} from "@workspace/api-zod";
import { defineRoute, requireUser, type RouteDef } from "../lib/route";
import { AppError, badRequest, unauthenticated } from "../lib/errors";
import { decrypt, encrypt, generateTotpSecret, hashPassword, verifyPassword, verifyTotp } from "../lib/crypto";
import { normalizeEmail } from "../lib/db-helpers";
import { limits } from "../middleware/rate-limit";
import { CSRF_COOKIE, SESSION_COOKIE, cookieOptions, type AuthInfo } from "../middleware/session";
import { consumeAuthToken, createAuthToken, createSession, findOrCreateClient, revokeAllSessions, revokeSession } from "../services/accounts";
import { audit } from "../services/audit";
import type { AppContext } from "../context";

const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

export async function buildMe(app: AppContext, auth: AuthInfo) {
  const orgs = await app.db
    .select({ id: organizations.id, name: organizations.name, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, auth.user.id));
  const u = auth.user;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: u.role,
    emailVerified: Boolean(u.emailVerifiedAt),
    mfaEnabled: Boolean(u.mfaEnabledAt),
    mfaRequired: auth.mfaRequired,
    mfaVerified: auth.session.mfaVerified,
    permissions: [...ROLE_PERMISSIONS[u.role]],
    organizations: orgs,
    notificationPrefs: u.notificationPrefs,
  };
}

export function authRoutes(app: AppContext): RouteDef[] {
  const authLimit = limits.auth();
  const resetLimit = limits.passwordReset();
  const fastHash = app.config.isTest;

  return [
    defineRoute({
      method: "get",
      path: "/auth/csrf",
      summary: "Issue the CSRF cookie (double-submit token)",
      tags: ["auth"],
      auth: "public",
      response: z.object({ token: z.string() }),
      handler: ({ req }) => ({ token: req.cookies[CSRF_COOKIE] as string }),
    }),
    defineRoute({
      method: "get",
      path: "/auth/session",
      summary: "Current session: the signed-in user, or null for anonymous visitors (always 200)",
      tags: ["auth"],
      auth: "public",
      response: z.object({ user: meSchema.nullable() }),
      handler: async ({ auth }) => ({ user: auth ? await buildMe(app, auth) : null }),
    }),
    defineRoute({
      method: "get",
      path: "/me",
      summary: "Current user, roles, permissions and organisations",
      tags: ["auth"],
      auth: "user",
      response: meSchema,
      handler: ({ auth }) => buildMe(app, requireUser(auth)),
    }),
    defineRoute({
      method: "patch",
      path: "/me",
      summary: "Update profile and notification preferences",
      tags: ["auth"],
      auth: "user",
      body: updateProfileBody,
      response: meSchema,
      handler: async ({ auth, body, req }) => {
        const a = requireUser(auth);
        const patch: Partial<typeof users.$inferInsert> = {};
        if (body.name !== undefined) patch.name = body.name;
        if (body.phone !== undefined) patch.phone = body.phone;
        if (body.notificationPrefs) patch.notificationPrefs = body.notificationPrefs;
        const [u] = await app.db.update(users).set(patch).where(eq(users.id, a.user.id)).returning();
        await audit(app.db, req, { action: "user.profile_updated", entityType: "user", entityId: a.user.id });
        return buildMe(app, { ...a, user: u });
      },
    }),
    defineRoute({
      method: "post",
      path: "/auth/register",
      summary: "Create a client account",
      tags: ["auth"],
      auth: "public",
      body: registerBody,
      middleware: [authLimit],
      response: z.object({ status: z.enum(["created", "check_email"]) }),
      handler: async ({ body, req, res, status }) => {
        const emailNormalized = normalizeEmail(body.email);
        const [existing] = await app.db.select().from(users).where(eq(users.emailNormalized, emailNormalized));
        if (existing) {
          // Never set a password on an existing account here (it may be a guest-checkout account
          // someone else is trying to claim). The owner of the mailbox gets a sign-in link instead.
          await app.db.transaction(async (tx) => {
            const token = await createAuthToken(tx, existing.id, "magic_link");
            await app.notifications.queue(tx, { template: "auth.magic_link", userId: existing.id, channels: ["email"], data: { path: `/auth/magic?token=${token}` } });
          });
          app.notifications.kick();
          status(202);
          return { status: "check_email" as const };
        }
        const passwordHash = await hashPassword(body.password, { fast: fastHash });
        const userId = await app.db.transaction(async (tx) => {
          const client = await findOrCreateClient(tx, { email: body.email, name: body.name, company: body.company, phone: body.phone });
          await tx.update(users).set({ passwordHash }).where(eq(users.id, client.userId));
          const token = await createAuthToken(tx, client.userId, "verify_email");
          await app.notifications.queue(tx, { template: "auth.verify_email", userId: client.userId, channels: ["email"], data: { name: body.name, path: `/auth/verify?token=${token}` } });
          await audit(tx, req, { action: "auth.registered", entityType: "user", entityId: client.userId });
          return client.userId;
        });
        app.notifications.kick();
        await createSession(app, req, res, userId, { mfaVerified: false });
        status(201);
        return { status: "created" as const };
      },
    }),
    defineRoute({
      method: "post",
      path: "/auth/login",
      summary: "Sign in with email and password (and TOTP code when MFA is enabled)",
      tags: ["auth"],
      auth: "public",
      body: loginBody,
      middleware: [authLimit],
      response: meSchema,
      handler: async ({ body, req, res }) => {
        const [u] = await app.db.select().from(users).where(eq(users.emailNormalized, normalizeEmail(body.email)));
        const now = new Date();
        if (u?.lockedUntil && u.lockedUntil > now) {
          throw new AppError(429, "rate_limited", "Too many failed attempts. Try again in a few minutes or reset your password.");
        }
        const valid = await verifyPassword(body.password, u?.passwordHash ?? null);
        if (!u || !valid || u.status !== "active") {
          if (u) {
            const failed = u.failedLoginCount + 1;
            await app.db
              .update(users)
              .set({ failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null })
              .where(eq(users.id, u.id));
            await audit(app.db, req, { action: "auth.login_failed", entityType: "user", entityId: u.id });
          }
          throw unauthenticated("Email or password is incorrect.");
        }
        let mfaVerified = false;
        if (u.mfaEnabledAt && u.mfaSecret) {
          if (!body.mfaCode) throw new AppError(401, "mfa_required", "Enter the 6-digit code from your authenticator app.");
          if (!verifyTotp(decrypt(u.mfaSecret, app.config.APP_SECRET), body.mfaCode)) {
            await audit(app.db, req, { action: "auth.mfa_failed", entityType: "user", entityId: u.id });
            throw unauthenticated("That code is not valid. Try the latest code.");
          }
          mfaVerified = true;
        }
        const session = await createSession(app, req, res, u.id, { mfaVerified });
        await audit(app.db, req, { action: "auth.login", entityType: "user", entityId: u.id });
        const security = await app.settings.security();
        return buildMe(app, { user: u, session, mfaRequired: isStaffRole(u.role) && (security.requireStaffMfa || Boolean(u.mfaEnabledAt)) });
      },
    }),
    defineRoute({
      method: "post",
      path: "/auth/logout",
      summary: "Sign out of this session",
      tags: ["auth"],
      auth: "public",
      response: okSchema,
      handler: async ({ auth, res }) => {
        if (auth) await revokeSession(app, auth.session.id);
        res.clearCookie(SESSION_COOKIE, cookieOptions(app));
        return { ok: true as const };
      },
    }),
    defineRoute({
      method: "post",
      path: "/auth/logout-all",
      summary: "Sign out of every session",
      tags: ["auth"],
      auth: "user",
      response: okSchema,
      handler: async ({ auth, res, req }) => {
        const a = requireUser(auth);
        await revokeAllSessions(app.db, a.user.id);
        await audit(app.db, req, { action: "auth.logout_all", entityType: "user", entityId: a.user.id });
        res.clearCookie(SESSION_COOKIE, cookieOptions(app));
        return { ok: true as const };
      },
    }),
    defineRoute({
      method: "post",
      path: "/auth/verify-email",
      summary: "Confirm email address with a token from email",
      tags: ["auth"],
      auth: "public",
      body: tokenBody,
      middleware: [authLimit],
      response: okSchema,
      handler: async ({ body, req, res, auth }) => {
        const userId = await app.db.transaction(async (tx) => {
          const t = await consumeAuthToken(tx, body.token, ["verify_email"]);
          await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, t.userId));
          await audit(tx, req, { action: "auth.email_verified", entityType: "user", entityId: t.userId });
          return t.userId;
        });
        if (!auth || auth.user.id !== userId) await createSession(app, req, res, userId, { mfaVerified: false });
        return { ok: true as const };
      },
    }),
    defineRoute({
      method: "post",
      path: "/auth/resend-verification",
      summary: "Resend the email verification link",
      tags: ["auth"],
      auth: "user",
      middleware: [resetLimit],
      response: okSchema,
      handler: async ({ auth }) => {
        const a = requireUser(auth);
        if (a.user.emailVerifiedAt) return { ok: true as const };
        await app.db.transaction(async (tx) => {
          const token = await createAuthToken(tx, a.user.id, "verify_email");
          await app.notifications.queue(tx, { template: "auth.verify_email", userId: a.user.id, channels: ["email"], data: { name: a.user.name, path: `/auth/verify?token=${token}` } });
        });
        app.notifications.kick();
        return { ok: true as const };
      },
    }),
    defineRoute({
      method: "post",
      path: "/auth/forgot-password",
      summary: "Email a password reset link (always responds 202)",
      tags: ["auth"],
      auth: "public",
      body: emailOnlyBody,
      middleware: [resetLimit],
      successStatus: 202,
      response: okSchema,
      handler: async ({ body }) => {
        const [u] = await app.db.select().from(users).where(eq(users.emailNormalized, normalizeEmail(body.email)));
        if (u && u.status === "active") {
          await app.db.transaction(async (tx) => {
            const token = await createAuthToken(tx, u.id, "password_reset");
            await app.notifications.queue(tx, { template: "auth.password_reset", userId: u.id, channels: ["email"], data: { path: `/auth/reset?token=${token}` } });
          });
          app.notifications.kick();
        }
        return { ok: true as const };
      },
    }),
    defineRoute({
      method: "post",
      path: "/auth/reset-password",
      summary: "Set a new password using a reset or invite token",
      tags: ["auth"],
      auth: "public",
      body: resetPasswordBody,
      middleware: [authLimit],
      response: okSchema,
      handler: async ({ body, req, res }) => {
        const passwordHash = await hashPassword(body.password, { fast: fastHash });
        const userId = await app.db.transaction(async (tx) => {
          const t = await consumeAuthToken(tx, body.token, ["password_reset", "invite"]);
          await tx.update(users).set({ passwordHash, emailVerifiedAt: new Date(), failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, t.userId));
          await revokeAllSessions(tx, t.userId);
          await audit(tx, req, { action: t.type === "invite" ? "auth.invite_accepted" : "auth.password_reset", entityType: "user", entityId: t.userId });
          return t.userId;
        });
        await createSession(app, req, res, userId, { mfaVerified: false });
        return { ok: true as const };
      },
    }),
    defineRoute({
      method: "post",
      path: "/auth/magic-link",
      summary: "Email a one-time sign-in link (always responds 202)",
      tags: ["auth"],
      auth: "public",
      body: emailOnlyBody,
      middleware: [resetLimit],
      successStatus: 202,
      response: okSchema,
      handler: async ({ body }) => {
        const [u] = await app.db.select().from(users).where(eq(users.emailNormalized, normalizeEmail(body.email)));
        if (u && u.status === "active") {
          await app.db.transaction(async (tx) => {
            const token = await createAuthToken(tx, u.id, "magic_link");
            await app.notifications.queue(tx, { template: "auth.magic_link", userId: u.id, channels: ["email"], data: { path: `/auth/magic?token=${token}` } });
          });
          app.notifications.kick();
        }
        return { ok: true as const };
      },
    }),
    defineRoute({
      method: "post",
      path: "/auth/magic-link/consume",
      summary: "Sign in with a one-time link token (also verifies the email address)",
      tags: ["auth"],
      auth: "public",
      body: tokenBody,
      middleware: [authLimit],
      response: z.object({ ok: z.literal(true), hasPassword: z.boolean() }),
      handler: async ({ body, req, res }) => {
        const result = await app.db.transaction(async (tx) => {
          const t = await consumeAuthToken(tx, body.token, ["magic_link", "invite"]);
          const [u] = await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, t.userId)).returning();
          if (u.status !== "active") throw unauthenticated("This account is disabled.");
          await audit(tx, req, { action: "auth.magic_link_login", entityType: "user", entityId: t.userId });
          return u;
        });
        await createSession(app, req, res, result.id, { mfaVerified: false });
        return { ok: true as const, hasPassword: Boolean(result.passwordHash) };
      },
    }),
    defineRoute({
      method: "post",
      path: "/auth/change-password",
      summary: "Change or set password (current password required if one exists)",
      tags: ["auth"],
      auth: "user",
      body: changePasswordBody.extend({ currentPassword: z.string().max(200).default("") }),
      middleware: [authLimit],
      response: okSchema,
      handler: async ({ auth, body, req, res }) => {
        const a = requireUser(auth);
        if (a.user.passwordHash && !(await verifyPassword(body.currentPassword, a.user.passwordHash))) {
          throw badRequest("Your current password is incorrect.");
        }
        const passwordHash = await hashPassword(body.newPassword, { fast: fastHash });
        await app.db.transaction(async (tx) => {
          await tx.update(users).set({ passwordHash }).where(eq(users.id, a.user.id));
          await revokeAllSessions(tx, a.user.id);
          await audit(tx, req, { action: "auth.password_changed", entityType: "user", entityId: a.user.id });
        });
        await createSession(app, req, res, a.user.id, { mfaVerified: a.session.mfaVerified });
        return { ok: true as const };
      },
    }),
    defineRoute({
      method: "post",
      path: "/auth/mfa/setup",
      summary: "Begin TOTP enrolment (returns secret and otpauth URI)",
      tags: ["auth"],
      auth: "user",
      response: z.object({ secret: z.string(), otpauthUri: z.string() }),
      handler: async ({ auth }) => {
        const a = requireUser(auth);
        if (a.user.mfaEnabledAt) throw badRequest("Two-factor authentication is already enabled.");
        const secret = generateTotpSecret();
        await app.db.update(users).set({ mfaSecret: encrypt(secret, app.config.APP_SECRET) }).where(eq(users.id, a.user.id));
        const brand = (await app.settings.business()).tradingName;
        const label = encodeURIComponent(`${brand}:${a.user.email}`);
        return { secret, otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(brand)}&digits=6&period=30` };
      },
    }),
    defineRoute({
      method: "post",
      path: "/auth/mfa/enable",
      summary: "Confirm TOTP enrolment with a code",
      tags: ["auth"],
      auth: "user",
      body: mfaCodeBody,
      middleware: [authLimit],
      response: okSchema,
      handler: async ({ auth, body, req }) => {
        const a = requireUser(auth);
        if (!a.user.mfaSecret) throw badRequest("Start two-factor setup first.");
        if (!verifyTotp(decrypt(a.user.mfaSecret, app.config.APP_SECRET), body.code)) throw badRequest("That code is not valid. Try the latest code.");
        await app.db.update(users).set({ mfaEnabledAt: new Date() }).where(eq(users.id, a.user.id));
        await app.db.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, a.session.id));
        await audit(app.db, req, { action: "auth.mfa_enabled", entityType: "user", entityId: a.user.id });
        return { ok: true as const };
      },
    }),
    defineRoute({
      method: "post",
      path: "/auth/mfa/verify",
      summary: "Step up the current session with a TOTP code",
      tags: ["auth"],
      auth: "user",
      body: mfaCodeBody,
      middleware: [authLimit],
      response: okSchema,
      handler: async ({ auth, body, req }) => {
        const a = requireUser(auth);
        if (!a.user.mfaSecret || !a.user.mfaEnabledAt) throw badRequest("Two-factor authentication is not enabled.");
        if (!verifyTotp(decrypt(a.user.mfaSecret, app.config.APP_SECRET), body.code)) {
          await audit(app.db, req, { action: "auth.mfa_failed", entityType: "user", entityId: a.user.id });
          throw badRequest("That code is not valid. Try the latest code.");
        }
        await app.db.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, a.session.id));
        return { ok: true as const };
      },
    }),
    defineRoute({
      method: "post",
      path: "/auth/mfa/disable",
      summary: "Disable TOTP (requires a current code; blocked when staff MFA is mandatory)",
      tags: ["auth"],
      auth: "user",
      body: mfaCodeBody,
      middleware: [authLimit],
      response: okSchema,
      handler: async ({ auth, body, req }) => {
        const a = requireUser(auth);
        const security = await app.settings.security();
        if (isStaffRole(a.user.role) && security.requireStaffMfa) throw badRequest("Two-factor authentication is mandatory for staff accounts.");
        if (!a.user.mfaSecret || !verifyTotp(decrypt(a.user.mfaSecret, app.config.APP_SECRET), body.code)) throw badRequest("That code is not valid.");
        await app.db.update(users).set({ mfaEnabledAt: null, mfaSecret: null }).where(eq(users.id, a.user.id));
        await audit(app.db, req, { action: "auth.mfa_disabled", entityType: "user", entityId: a.user.id });
        return { ok: true as const };
      },
    }),
  ];
}
