import { and, desc, lt, or, eq, sql, type SQL, type Column } from "drizzle-orm";
import { numberSequences, type DbOrTx } from "@workspace/db";
import { badRequest } from "./errors";

/**
 * Concurrency-safe, gapless document numbering. The counter row is locked by
 * the UPDATE inside the caller's transaction, so concurrent callers serialise.
 * Example: nextNumber(tx, "INV") → "INV-2026-00001".
 */
export async function nextNumber(tx: DbOrTx, prefix: string, now = new Date(), pad = 5): Promise<string> {
  const year = new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", year: "numeric" }).format(now);
  const key = `${prefix}-${year}`;
  const rows = await tx
    .insert(numberSequences)
    .values({ key, value: 1 })
    .onConflictDoUpdate({ target: numberSequences.key, set: { value: sql`${numberSequences.value} + 1` } })
    .returning({ value: numberSequences.value });
  return `${key}-${String(rows[0].value).padStart(pad, "0")}`;
}

// ---------------------------------------------------------------- cursor pagination
interface Cursor {
  t: string;
  id: string;
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: createdAt.toISOString(), id } satisfies Cursor)).toString("base64url");
}

export function decodeCursor(cursor: string | undefined): Cursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Cursor;
    if (typeof parsed.t !== "string" || typeof parsed.id !== "string" || Number.isNaN(Date.parse(parsed.t))) throw new Error();
    return parsed;
  } catch {
    throw badRequest("Invalid pagination cursor.");
  }
}

/** WHERE clause for keyset pagination ordered by (createdAt DESC, id DESC). */
export function cursorWhere(createdAtCol: Column, idCol: Column, cursor: string | undefined): SQL | undefined {
  const c = decodeCursor(cursor);
  if (!c) return undefined;
  const t = new Date(c.t);
  return or(lt(createdAtCol, t), and(eq(createdAtCol, t), lt(idCol, c.id)));
}

export function cursorOrder(createdAtCol: Column, idCol: Column) {
  return [desc(createdAtCol), desc(idCol)] as const;
}

export function pageOf<T extends { createdAt: Date; id: string }>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Escape LIKE wildcards in user-supplied search strings. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = (err as { cause?: { code?: string; constraint?: string }; code?: string; constraint?: string }) ?? {};
  const code = e.code ?? e.cause?.code;
  const name = e.constraint ?? e.cause?.constraint;
  return code === "23505" && (!constraint || name === constraint);
}
