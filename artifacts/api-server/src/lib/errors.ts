import type { ZodError } from "zod/v4";

/** Stable, documented error codes returned as `code` in problem+json bodies. */
export type ErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthenticated"
  | "mfa_required"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "version_conflict"
  | "rate_limited"
  | "csrf_failed"
  | "payment_provider_error"
  | "payment_not_configured"
  | "invalid_transition"
  | "selection_invalid"
  | "account_exists"
  | "unprocessable"
  | "internal_error";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly errors?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (msg: string, code: ErrorCode = "bad_request") => new AppError(400, code, msg);
export const unauthenticated = (msg = "Please sign in to continue.") => new AppError(401, "unauthenticated", msg);
export const forbidden = (msg = "You do not have permission to do that.") => new AppError(403, "forbidden", msg);
/** Use for missing records AND records the caller may not see (no existence leak). */
export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found.`);
export const conflict = (msg: string, code: ErrorCode = "conflict") => new AppError(409, code, msg);
export const unprocessable = (msg: string, code: ErrorCode = "unprocessable") => new AppError(422, code, msg);

export function fromZod(error: ZodError, where: string): AppError {
  return new AppError(
    400,
    "validation_failed",
    `Invalid ${where}.`,
    error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}
