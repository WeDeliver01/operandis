/**
 * Money helpers. All amounts are integer minor units (cents) plus an ISO
 * currency code. Never use floating point for money arithmetic.
 *
 * Basis points (bps): 10_000 bps = 100 %.
 */

export type CurrencyCode = "ZAR" | "USD" | "EUR" | "GBP";

export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}

export const BPS_DENOMINATOR = 10_000;

export function assertMinor(value: number, label = "amount"): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer number of minor units (got ${value})`);
  }
  return value;
}

/** Round-half-up division of two bigints (works for negative numerators too). */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** amount × bps / 10 000, rounded half-up, exact (BigInt intermediate). */
export function applyBps(amountMinor: number, bps: number): number {
  assertMinor(amountMinor);
  assertMinor(bps, "bps");
  const result = divRoundHalfUp(BigInt(amountMinor) * BigInt(bps), BigInt(BPS_DENOMINATOR));
  return Number(result);
}

/** Round to the nearest multiple of `step` minor units (half-up). step=100000 → nearest R1 000. */
export function roundToStep(amountMinor: number, step: number): number {
  assertMinor(amountMinor);
  if (!step || step <= 1) return amountMinor;
  return Number(divRoundHalfUp(BigInt(amountMinor), BigInt(step)) * BigInt(step));
}

export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += assertMinor(v);
  return assertMinor(total, "sum");
}

/**
 * Split `total` into parts proportional to `weightsBps`, guaranteeing the parts
 * add up exactly to `total`. The rounding remainder goes to the last part.
 */
export function allocateByBps(totalMinor: number, weightsBps: readonly number[]): number[] {
  assertMinor(totalMinor);
  if (weightsBps.length === 0) return [];
  const weightSum = weightsBps.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) throw new RangeError("allocation weights must sum to a positive number");
  const parts = weightsBps.map((w) =>
    Number(divRoundHalfUp(BigInt(totalMinor) * BigInt(w), BigInt(weightSum))),
  );
  const drift = totalMinor - sumMinor(parts);
  parts[parts.length - 1] += drift;
  return parts;
}

export function formatMoney(amountMinor: number, currency: CurrencyCode = "ZAR", opts?: { decimals?: boolean }): string {
  const showDecimals = opts?.decimals ?? amountMinor % 100 !== 0;
  return new Intl.NumberFormat(currency === "ZAR" ? "en-ZA" : "en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(amountMinor / 100);
}

/** Parse a user-entered rand amount ("12 500,50", "12500.5", "R 1 000") to minor units. */
export function parseMajorToMinor(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new RangeError("invalid amount");
    return Math.round(input * 100);
  }
  const cleaned = input.replace(/[R\s ]/gi, "");
  let normalised = cleaned;
  if (/,\d{1,2}$/.test(cleaned)) normalised = cleaned.replace(/\./g, "").replace(",", ".");
  else normalised = cleaned.replace(/,/g, "");
  const value = Number(normalised);
  if (!Number.isFinite(value)) throw new RangeError(`invalid amount "${input}"`);
  const [whole, frac = ""] = normalised.split(".");
  const sign = whole.startsWith("-") ? -1 : 1;
  const wholeAbs = Math.abs(Number(whole));
  const fracMinor = Number((frac + "00").slice(0, 2));
  return sign * (wholeAbs * 100 + fracMinor);
}

export interface TaxConfig {
  /** Whether tax is applied at all. Default false: VAT registration is an owner/accountant decision. */
  enabled: boolean;
  rateBps: number;
  label: string;
  /** If true, entered prices already include tax and tax is extracted, not added. */
  pricesIncludeTax: boolean;
}

export const NO_TAX: TaxConfig = { enabled: false, rateBps: 0, label: "VAT", pricesIncludeTax: false };

export interface TaxBreakdown {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export function computeTax(amountMinor: number, tax: TaxConfig): TaxBreakdown {
  assertMinor(amountMinor);
  if (!tax.enabled || tax.rateBps <= 0) {
    return { subtotalMinor: amountMinor, taxMinor: 0, totalMinor: amountMinor };
  }
  if (tax.pricesIncludeTax) {
    const subtotal = Number(
      divRoundHalfUp(BigInt(amountMinor) * BigInt(BPS_DENOMINATOR), BigInt(BPS_DENOMINATOR + tax.rateBps)),
    );
    return { subtotalMinor: subtotal, taxMinor: amountMinor - subtotal, totalMinor: amountMinor };
  }
  const taxMinor = applyBps(amountMinor, tax.rateBps);
  return { subtotalMinor: amountMinor, taxMinor, totalMinor: amountMinor + taxMinor };
}

export type DepositRule =
  | { type: "full" }
  | { type: "percent"; percentBps: number }
  | { type: "fixed"; amountMinor: number }
  | { type: "none" };

export function computeDeposit(totalMinor: number, rule: DepositRule): number {
  assertMinor(totalMinor);
  switch (rule.type) {
    case "full":
      return totalMinor;
    case "none":
      return 0;
    case "percent":
      return Math.min(totalMinor, applyBps(totalMinor, rule.percentBps));
    case "fixed":
      return Math.min(totalMinor, rule.amountMinor);
  }
}
