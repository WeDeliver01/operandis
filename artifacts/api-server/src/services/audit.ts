import { auditEvents, analyticsEvents, type DbOrTx } from "@workspace/db";
import type { AnalyticsEvent } from "@workspace/domain";
import type { Request } from "express";

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** Strip secrets before persisting snapshots in the audit log. */
function scrub(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(scrub);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/password|secret|token|passphrase|mfa/i.test(k)) out[k] = "[redacted]";
    else out[k] = scrub(v);
  }
  return out;
}

export async function audit(tx: DbOrTx, req: Request | null, input: AuditInput): Promise<void> {
  await tx.insert(auditEvents).values({
    actorId: req?.auth?.user.id ?? null,
    actorRole: req?.auth?.user.role ?? (req ? "anonymous" : "system"),
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    before: input.before === undefined ? null : scrub(input.before),
    after: input.after === undefined ? null : scrub(input.after),
    reason: input.reason ?? null,
    ip: req?.ip ?? null,
    requestId: (req?.id as string | undefined) ?? null,
  });
}

/** Server-side funnel events (operational, not marketing — no third-party sharing). */
export async function track(
  tx: DbOrTx,
  name: AnalyticsEvent,
  data: { userId?: string | null; entityType?: string; entityId?: string; properties?: Record<string, unknown> } = {},
): Promise<void> {
  await tx.insert(analyticsEvents).values({
    name,
    anonymousId: "server",
    userId: data.userId ?? null,
    entityType: data.entityType ?? null,
    entityId: data.entityId ?? null,
    properties: data.properties ?? {},
  });
}
