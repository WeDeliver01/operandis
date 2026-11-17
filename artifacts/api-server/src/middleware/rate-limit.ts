import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import type { RequestHandler } from "express";
import { AppError } from "../lib/errors";

/**
 * In-memory limiter per process. For multi-instance deployments swap the store
 * for a shared one (e.g. Redis) — see docs/deployment.md.
 */
let disabled = false;
export function setRateLimitDisabled(v: boolean) {
  disabled = v;
}

function limiter(windowMs: number, limit: number, name: string): RequestHandler {
  const opts: Partial<Options> = {
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => disabled,
    keyGenerator: (req) => `${name}:${ipKeyGenerator(req.ip ?? "unknown")}`,
    handler: (_req, _res, next) => next(new AppError(429, "rate_limited", "Too many requests. Please wait a moment and try again.")),
  };
  return rateLimit(opts);
}

export const limits = {
  auth: () => limiter(15 * 60_000, 20, "auth"),
  passwordReset: () => limiter(60 * 60_000, 6, "reset"),
  contact: () => limiter(10 * 60_000, 5, "contact"),
  configuratorSubmit: () => limiter(60 * 60_000, 10, "cfg-submit"),
  configuratorDraft: () => limiter(60 * 60_000, 300, "cfg-draft"),
  checkout: () => limiter(60 * 60_000, 20, "checkout"),
  webhook: () => limiter(60_000, 300, "webhook"),
  analytics: () => limiter(60_000, 120, "analytics"),
  upload: () => limiter(60 * 60_000, 60, "upload"),
  general: () => limiter(60_000, 600, "general"),
};
