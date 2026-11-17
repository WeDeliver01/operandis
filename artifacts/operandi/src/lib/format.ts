import { formatMoney } from "@workspace/domain/money";

const TZ = "Africa/Johannesburg";

export const money = (minor: number | null | undefined, opts?: { decimals?: boolean }) =>
  minor === null || minor === undefined ? "—" : formatMoney(minor, "ZAR", opts);

export const moneyRange = (low: number, high: number) => (low === high ? money(low) : `${money(low)} – ${money(high)}`);

export function date(value: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-ZA", { timeZone: TZ, ...opts }).format(d);
}

export const dateTime = (v: string | Date | null | undefined) => date(v, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function relative(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  const diff = (d.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("en-ZA", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return date(d);
}

export const percent = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

export const humanize = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—");

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Rand input (major units) → minor units; returns null when invalid. */
export function randToMinor(input: string): number | null {
  const cleaned = input.replace(/[R\s ,]/gi, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
export const minorToRand = (minor: number) => (minor / 100).toFixed(minor % 100 === 0 ? 0 : 2);
