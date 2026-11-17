import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { sql } from "drizzle-orm";
import type { AppContext } from "./context";
import { AppError } from "./lib/errors";
import { mountRoutes, type RouteDef } from "./lib/route";
import { csrfMiddleware, sessionMiddleware } from "./middleware/session";
import { limits, setRateLimitDisabled } from "./middleware/rate-limit";
import { authRoutes } from "./modules/auth";
import { publicContentRoutes, adminContentRoutes } from "./modules/content";
import { publicCatalogueRoutes, adminCatalogueRoutes } from "./modules/catalogue";
import { configuratorRoutes } from "./modules/configurator";
import { adminPricingRoutes } from "./modules/pricing";
import { contactRoutes, adminCrmRoutes } from "./modules/crm";
import { adminProposalRoutes, portalProposalRoutes } from "./modules/proposals";
import { checkoutRoutes, webhookRoutes, adminFinanceRoutes, portalFinanceRoutes } from "./modules/commerce";
import { adminProjectRoutes, portalProjectRoutes } from "./modules/projects";
import { fileRoutes } from "./modules/files";
import { portalRoutes } from "./modules/portal";
import { adminSystemRoutes } from "./modules/system";
import { openApiRoutes } from "./modules/openapi";

export const API_BASE = "/api/v1";

export function allRoutes(app: AppContext): RouteDef[] {
  return [
    ...authRoutes(app),
    ...publicContentRoutes(app),
    ...publicCatalogueRoutes(app),
    ...configuratorRoutes(app),
    ...contactRoutes(app),
    ...checkoutRoutes(app),
    ...webhookRoutes(app),
    ...fileRoutes(app),
    ...portalRoutes(app),
    ...portalProposalRoutes(app),
    ...portalFinanceRoutes(app),
    ...portalProjectRoutes(app),
    ...adminCrmRoutes(app),
    ...adminContentRoutes(app),
    ...adminCatalogueRoutes(app),
    ...adminPricingRoutes(app),
    ...adminProposalRoutes(app),
    ...adminFinanceRoutes(app),
    ...adminProjectRoutes(app),
    ...adminSystemRoutes(app),
    ...openApiRoutes(app),
  ] as RouteDef[];
}

export function createApp(app: AppContext) {
  setRateLimitDisabled(app.config.RATE_LIMIT_DISABLED);
  const server = express();
  server.disable("x-powered-by");
  server.set("trust proxy", app.config.TRUST_PROXY === "true" ? true : app.config.TRUST_PROXY === "false" ? false : app.config.TRUST_PROXY);

  server.use(
    pinoHttp({
      logger: app.logger,
      genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"];
        const id = typeof incoming === "string" && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
        res.setHeader("x-request-id", id);
        return id;
      },
      customProps: (req) => ({ actorId: (req as Request).auth?.user.id }),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url?.split("?")[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req) => req.url === "/api/v1/health" || req.url === "/api/healthz" },
    }),
  );

  server.use(
    helmet({
      contentSecurityPolicy: app.config.SERVE_WEB_DIST
        ? {
            useDefaults: true,
            directives: {
              "script-src": ["'self'", "https://app.cal.com", "https://www.googletagmanager.com", "https://connect.facebook.net", "https://snap.licdn.com"],
              "frame-src": ["'self'", "https://app.cal.com", "https://cal.com"],
              "img-src": ["'self'", "data:", "https:"],
              "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
              "font-src": ["'self'", "https://fonts.gstatic.com"],
              "connect-src": ["'self'", "https://app.cal.com", "https://www.google-analytics.com", "https://*.analytics.google.com"],
              "form-action": ["'self'", "https://sandbox.payfast.co.za", "https://www.payfast.co.za"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // CORS only for explicitly configured origins (same-origin deploys need none).
  server.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && app.config.corsOrigins.includes(origin)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("access-control-allow-credentials", "true");
      res.setHeader("access-control-allow-headers", "content-type, x-csrf-token, x-request-id");
      res.setHeader("access-control-allow-methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
      res.setHeader("vary", "origin");
      if (req.method === "OPTIONS") return void res.status(204).end();
    }
    next();
  });

  // Webhooks need the exact raw body for signature verification.
  server.use(`${API_BASE}/webhooks`, express.raw({ type: () => true, limit: "256kb" }), (req, _res, next) => {
    req.rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    next();
  });
  server.use(express.json({ limit: "1mb" }));
  server.use(express.urlencoded({ extended: false, limit: "256kb" }));
  server.use(cookieParser());

  // Health & readiness (no auth, no CSRF).
  server.get("/api/healthz", (_req, res) => void res.json({ status: "ok" }));
  server.get(`${API_BASE}/health`, (_req, res) => void res.json({ status: "ok" }));
  server.get(`${API_BASE}/ready`, async (_req, res) => {
    const checks: Record<string, string> = {};
    try {
      await app.db.execute(sql`select 1`);
      checks.database = "ok";
    } catch {
      checks.database = "unavailable";
    }
    checks.email = app.notifications.transportName;
    checks.storage = app.storage.name;
    const ok = checks.database === "ok";
    res.status(ok ? 200 : 503).json({ status: ok ? "ready" : "degraded", checks });
  });

  server.use(API_BASE, limits.general());
  server.use(API_BASE, sessionMiddleware(app));
  server.use(API_BASE, csrfMiddleware(app, ["/webhooks/", "/files/blob"]));

  const router = express.Router();
  mountRoutes(router, allRoutes(app), app, API_BASE);
  server.use(API_BASE, router);

  server.use(API_BASE, (_req, _res, next) => next(new AppError(404, "not_found", "No such API endpoint.")));

  // Optional: serve the built SPA from the same origin (single-container deploys).
  if (app.config.SERVE_WEB_DIST) {
    const dist = path.resolve(app.config.SERVE_WEB_DIST);
    if (fs.existsSync(path.join(dist, "index.html"))) {
      server.use(express.static(dist, { index: false, maxAge: "1h", setHeaders: (res, p) => {
        if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader("cache-control", "public, max-age=31536000, immutable");
      } }));
      server.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
    } else {
      app.logger.warn({ dist }, "SERVE_WEB_DIST set but index.html not found");
    }
  }

  // Centralised problem+json error handling.
  server.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = String(req.id ?? "");
    let appErr: AppError;
    if (err instanceof AppError) appErr = err;
    else if ((err as { type?: string }).type === "entity.parse.failed") appErr = new AppError(400, "bad_request", "Malformed JSON body.");
    else if ((err as { type?: string }).type === "entity.too.large") appErr = new AppError(413, "bad_request", "Request body too large.");
    else if ((err as { code?: string }).code === "LIMIT_FILE_SIZE") appErr = new AppError(413, "bad_request", "File is too large.");
    else {
      req.log?.error({ err }, "unhandled error");
      appErr = new AppError(500, "internal_error", "Something went wrong on our side. Please try again.");
    }
    if (appErr.status >= 500 && err instanceof AppError) req.log?.error({ err }, "server error");
    res
      .status(appErr.status)
      .type("application/problem+json")
      .json({
        type: `https://operandis.co.za/problems/${appErr.code}`,
        title: appErr.message,
        status: appErr.status,
        code: appErr.code,
        detail: appErr.message,
        requestId,
        ...(appErr.errors ? { errors: appErr.errors } : {}),
      });
  });

  return server;
}
