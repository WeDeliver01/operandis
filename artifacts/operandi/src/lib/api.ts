import { ApiError, customFetch } from "@workspace/api-client-react";
import type { Problem } from "@workspace/api-zod";

/**
 * Typed fetch wrapper for the Operandis API.
 * - Same-origin cookie session (no tokens in JS).
 * - Double-submit CSRF: echoes the `op_csrf` cookie in `x-csrf-token` on writes.
 * - Errors surface as ApiError with a problem+json body (`code`, `detail`, `errors`).
 */

export const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/v1`;

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

let csrfPromise: Promise<string> | null = null;
async function csrfToken(): Promise<string> {
  const existing = readCookie("op_csrf");
  if (existing) return existing;
  csrfPromise ??= customFetch<{ token: string }>(`${API_BASE}/auth/csrf`, { credentials: "same-origin" }).then((r) => {
    csrfPromise = null;
    return readCookie("op_csrf") ?? r.token;
  });
  return csrfPromise;
}

export async function api<T>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (method !== "GET") headers["x-csrf-token"] = await csrfToken();
  const init: RequestInit = { method, headers, credentials: "same-origin" };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return customFetch<T>(`${API_BASE}${path}`, { ...init, responseType: "auto" });
}

export const get = <T>(path: string) => api<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => api<T>("POST", path, body ?? {});
export const patch = <T>(path: string, body?: unknown) => api<T>("PATCH", path, body ?? {});
export const put = <T>(path: string, body?: unknown) => api<T>("PUT", path, body ?? {});
export const del = <T>(path: string) => api<T>("DELETE", path);

export function problemOf(err: unknown): Problem | null {
  if (err instanceof ApiError && err.data && typeof err.data === "object") return err.data as Problem;
  return null;
}

/** Human-readable message for any thrown error. */
export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const p = problemOf(err);
  if (p?.errors?.length) return p.errors.map((e) => e.message).join(" ");
  if (p?.detail) return p.detail;
  if (err instanceof ApiError && err.status === 0) return "You appear to be offline.";
  if (err instanceof TypeError) return "We couldn't reach the server. Check your connection and try again.";
  return fallback;
}

/** Field-level errors keyed by dotted path (from problem+json `errors`). */
export function fieldErrors(err: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of problemOf(err)?.errors ?? []) out[e.path] = e.message;
  return out;
}

export function statusOf(err: unknown): number | null {
  return err instanceof ApiError ? err.status : null;
}

export function newIdempotencyKey(prefix = "web"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Download an authenticated binary (PDF) via the session cookie. */
export async function downloadFile(path: string, fileName: string) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export { ApiError };
