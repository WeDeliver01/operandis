import express, { type Request, type RequestHandler, type Response } from "express";
import type { z } from "zod/v4";
import { hasPermission, isStaffRole, type Permission } from "@workspace/domain";
import { AppError, forbidden, fromZod, unauthenticated } from "./errors";
import type { AppContext } from "../context";
import type { AuthInfo } from "../middleware/session";

/**
 * Typed route definitions. Each definition is registered with Express AND
 * recorded for OpenAPI generation, so the published contract is always the
 * one the server actually validates against.
 */

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
export type AuthLevel = "public" | "user" | "staff";

type ZodAny = z.ZodType;

export interface HandlerCtx<B, Q, P> {
  req: Request;
  res: Response;
  body: B;
  query: Q;
  params: P;
  auth: AuthInfo | null;
  app: AppContext;
  /** Set a non-200 status for the JSON response. */
  status: (code: number) => void;
}

export interface RouteDef<B extends ZodAny | undefined = ZodAny | undefined, Q extends ZodAny | undefined = ZodAny | undefined, P extends ZodAny | undefined = ZodAny | undefined> {
  method: HttpMethod;
  path: string;
  summary: string;
  tags: string[];
  auth: AuthLevel;
  /** Caller needs ANY of these permissions. Implies auth "staff". */
  permission?: Permission | Permission[];
  body?: B;
  query?: Q;
  params?: P;
  response?: ZodAny;
  /** HTTP status for success responses (documentation; handler may override). */
  successStatus?: number;
  middleware?: RequestHandler[];
  /** Skip CSRF (provider webhooks only). */
  csrfExempt?: boolean;
  /** Response is not JSON (PDF/file/redirect). */
  rawResponse?: { contentType: string };
  description?: string;
  handler: (
    ctx: HandlerCtx<
      B extends ZodAny ? z.infer<B> : undefined,
      Q extends ZodAny ? z.infer<Q> : Record<string, unknown>,
      P extends ZodAny ? z.infer<P> : Record<string, string>
    >,
  ) => Promise<unknown> | unknown;
}

export const routeRegistry: RouteDef[] = [];

export function defineRoute<B extends ZodAny | undefined = undefined, Q extends ZodAny | undefined = undefined, P extends ZodAny | undefined = undefined>(
  def: RouteDef<B, Q, P>,
): RouteDef<B, Q, P> {
  return def;
}

export function requireUser(auth: AuthInfo | null): AuthInfo {
  if (!auth) throw unauthenticated();
  return auth;
}

function checkAuth(def: RouteDef, auth: AuthInfo | null, app: AppContext) {
  const level: AuthLevel = def.permission ? "staff" : def.auth;
  if (level === "public") return;
  if (!auth) throw unauthenticated();
  if (level === "staff") {
    if (!isStaffRole(auth.user.role)) throw forbidden();
    if (auth.mfaRequired && !auth.session.mfaVerified) {
      throw new AppError(403, "mfa_required", "Two-factor authentication is required for staff access.");
    }
  }
  if (def.permission) {
    const perms = Array.isArray(def.permission) ? def.permission : [def.permission];
    if (!perms.some((p) => hasPermission(auth.user.role, p))) throw forbidden();
  }
  void app;
}

/** Express path → OpenAPI path (/a/:id → /a/{id}). */
export function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

export function mountRoutes(router: express.Router, defs: RouteDef[], app: AppContext, basePath: string) {
  for (const def of defs) {
    if (!routeRegistry.some((r) => r.method === def.method && r.path === basePath + def.path)) {
      routeRegistry.push({ ...def, path: basePath + def.path } as RouteDef);
    }
    const handlers: RequestHandler[] = [...(def.middleware ?? [])];
    handlers.push(async (req, res, next) => {
      try {
        const auth = req.auth ?? null;
        checkAuth(def, auth, app);
        let params: unknown = req.params;
        if (def.params) {
          const r = def.params.safeParse(req.params);
          if (!r.success) throw fromZod(r.error, "path parameters");
          params = r.data;
        }
        let query: unknown = req.query;
        if (def.query) {
          const r = def.query.safeParse(req.query);
          if (!r.success) throw fromZod(r.error, "query");
          query = r.data;
        }
        let body: unknown = undefined;
        if (def.body) {
          const r = def.body.safeParse(req.body ?? {});
          if (!r.success) throw fromZod(r.error, "request body");
          body = r.data;
        }
        let status = def.successStatus ?? 200;
        const result = await def.handler({
          req,
          res,
          body: body as never,
          query: query as never,
          params: params as never,
          auth,
          app,
          status: (code) => {
            status = code;
          },
        });
        if (res.headersSent) return;
        if (result === undefined) {
          res.status(status === 200 ? 204 : status).end();
          return;
        }
        if (def.response && !app.config.isProd) {
          const check = def.response.safeParse(result);
          if (!check.success) {
            app.logger.error({ route: def.path, issues: check.error.issues.slice(0, 5) }, "response contract violation");
            if (app.config.isTest) throw new AppError(500, "internal_error", `Response contract violation on ${def.method.toUpperCase()} ${def.path}`);
          }
        }
        res.status(status).json(result);
      } catch (err) {
        next(err);
      }
    });
    router[def.method](def.path, ...handlers);
  }
}
