import type { NextFunction, Request, Response } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { sessions, users } from "@workspace/db";
import { isStaffRole } from "@workspace/domain";
import { randomToken, safeEqual, sha256 } from "../lib/crypto";
import { AppError } from "../lib/errors";
import type { AppContext } from "../context";

export const SESSION_COOKIE = "op_session";
export const CSRF_COOKIE = "op_csrf";
export const CSRF_HEADER = "x-csrf-token";

export interface AuthInfo {
  user: typeof users.$inferSelect;
  session: typeof sessions.$inferSelect;
  /** Staff MFA policy applies to this user. */
  mfaRequired: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthInfo | null;
      rawBody?: Buffer;
    }
  }
}

export function cookieOptions(app: AppContext, maxAgeMs?: number) {
  return {
    httpOnly: true,
    secure: app.config.cookieSecure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeMs,
  };
}

export function sessionMiddleware(app: AppContext) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    req.auth = null;
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token || typeof token !== "string" || token.length > 200) return next();
    try {
      const now = new Date();
      const rows = await app.db
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)));
      const row = rows[0];
      if (row && row.user.status === "active") {
        const security = await app.settings.security();
        const mfaRequired = isStaffRole(row.user.role) && (security.requireStaffMfa || Boolean(row.user.mfaEnabledAt));
        req.auth = { user: row.user, session: row.session, mfaRequired };
        if (now.getTime() - row.session.lastSeenAt.getTime() > 5 * 60_000) {
          await app.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.session.id));
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Double-submit CSRF protection for cookie-authenticated APIs: every
 * state-changing request must echo the (non-HttpOnly) CSRF cookie in a header.
 * Cross-site pages can't read the cookie, so they can't forge the header.
 */
export function csrfMiddleware(app: AppContext, exemptPrefixes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    let cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
    if (!cookie) {
      cookie = randomToken(24);
      res.cookie(CSRF_COOKIE, cookie, { ...cookieOptions(app), httpOnly: false });
      req.cookies[CSRF_COOKIE] = cookie;
    }
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (exemptPrefixes.some((p) => req.path.startsWith(p))) return next();
    const header = req.get(CSRF_HEADER);
    if (!header || !safeEqual(header, cookie)) {
      return next(new AppError(403, "csrf_failed", "Security token missing or expired. Refresh the page and try again."));
    }
    next();
  };
}
