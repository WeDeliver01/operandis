import { computeDeposit, computeTax, sumMinor, NO_TAX, type DepositRule, type TaxConfig } from "../money";

/**
 * Authoritative package price calculation (server-side). The browser may call
 * the same function for instant feedback, but the server always recalculates.
 */

export type PricingMode = "fixed" | "starting_from" | "quote_only";
export type OptionPricingType = "fixed" | "per_unit" | "manual_review";

export interface PackageVariantSnapshot {
  key: string;
  name: string;
  priceMinor: number;
  active: boolean;
}

export interface PackageOptionSnapshot {
  key: string;
  label: string;
  pricingType: OptionPricingType;
  amountMinor: number;
  unitLabel?: string | null;
  minQty: number;
  maxQty: number;
  active: boolean;
  /** Option keys that must also be selected. */
  requires: string[];
  /** Option keys that cannot be combined with this one. */
  excludes: string[];
  /** If non-empty, only allowed with these variant keys. */
  variants: string[];
}

export interface PackageSnapshot {
  id: string;
  slug: string;
  name: string;
  version: number;
  status: "draft" | "published" | "paused" | "archived";
  pricingMode: PricingMode;
  priceMinor: number;
  currency: "ZAR";
  deposit: DepositRule;
  variants: PackageVariantSnapshot[];
  options: PackageOptionSnapshot[];
}

export interface PackageSelection {
  variantKey?: string | null;
  options: { key: string; quantity: number }[];
}

export interface PackageQuoteLine {
  kind: "package" | "variant" | "option";
  key: string;
  description: string;
  quantity: number;
  unitMinor: number;
  totalMinor: number;
}

export interface PackageQuote {
  currency: "ZAR";
  lines: PackageQuoteLine[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  depositMinor: number;
  dueNowMinor: number;
  balanceMinor: number;
  /** Can be purchased online right now. False when quote-only or manual-review options chosen. */
  purchasable: boolean;
  requiresQuoteReasons: string[];
}

export class SelectionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "SelectionError";
  }
}

export function quotePackage(pkg: PackageSnapshot, selection: PackageSelection, tax: TaxConfig = NO_TAX): PackageQuote {
  const reasons: string[] = [];
  const lines: PackageQuoteLine[] = [];

  if (pkg.status !== "published") {
    throw new SelectionError("package_unavailable", "This package is not currently available for purchase.");
  }

  const activeVariants = pkg.variants.filter((v) => v.active);
  let variant: PackageVariantSnapshot | undefined;
  if (activeVariants.length > 0) {
    if (!selection.variantKey) throw new SelectionError("variant_required", "Choose a package tier.");
    variant = activeVariants.find((v) => v.key === selection.variantKey);
    if (!variant) throw new SelectionError("variant_invalid", "The selected tier is not available.");
    lines.push({ kind: "variant", key: variant.key, description: `${pkg.name} — ${variant.name}`, quantity: 1, unitMinor: variant.priceMinor, totalMinor: variant.priceMinor });
  } else {
    if (selection.variantKey) throw new SelectionError("variant_invalid", "This package has no tiers.");
    lines.push({ kind: "package", key: pkg.slug, description: pkg.name, quantity: 1, unitMinor: pkg.priceMinor, totalMinor: pkg.priceMinor });
  }

  const chosen = new Map<string, number>();
  for (const sel of selection.options) {
    if (chosen.has(sel.key)) throw new SelectionError("option_duplicate", `Option "${sel.key}" selected twice.`);
    chosen.set(sel.key, sel.quantity);
  }

  for (const [key, qty] of chosen) {
    const opt = pkg.options.find((o) => o.key === key && o.active);
    if (!opt) throw new SelectionError("option_invalid", `Add-on "${key}" is not available.`);
    if (!Number.isInteger(qty) || qty < opt.minQty || qty > opt.maxQty || qty < 1) {
      throw new SelectionError("option_quantity", `Quantity for "${opt.label}" must be between ${Math.max(1, opt.minQty)} and ${opt.maxQty}.`);
    }
    if (opt.variants.length > 0 && (!variant || !opt.variants.includes(variant.key))) {
      throw new SelectionError("option_variant", `"${opt.label}" is not available with the selected tier.`);
    }
    for (const req of opt.requires) {
      if (!chosen.has(req)) {
        const reqLabel = pkg.options.find((o) => o.key === req)?.label ?? req;
        throw new SelectionError("option_requires", `"${opt.label}" requires "${reqLabel}".`);
      }
    }
    for (const ex of opt.excludes) {
      if (chosen.has(ex)) {
        const exLabel = pkg.options.find((o) => o.key === ex)?.label ?? ex;
        throw new SelectionError("option_excludes", `"${opt.label}" cannot be combined with "${exLabel}".`);
      }
    }
    if (opt.pricingType === "manual_review") {
      reasons.push(`"${opt.label}" is priced after a short review.`);
      lines.push({ kind: "option", key: opt.key, description: `${opt.label} (priced on review)`, quantity: qty, unitMinor: 0, totalMinor: 0 });
      continue;
    }
    const unit = opt.amountMinor;
    const quantity = opt.pricingType === "fixed" ? 1 : qty;
    lines.push({
      kind: "option",
      key: opt.key,
      description: opt.pricingType === "per_unit" && opt.unitLabel ? `${opt.label} (${quantity} × ${opt.unitLabel})` : opt.label,
      quantity,
      unitMinor: unit,
      totalMinor: unit * quantity,
    });
  }

  if (pkg.pricingMode === "quote_only") reasons.push("This package is scoped and priced in a proposal.");
  if (pkg.pricingMode === "starting_from") reasons.push("Final price is confirmed after a scope review; the amount shown is the starting price.");

  const net = sumMinor(lines.map((l) => l.totalMinor));
  const taxed = computeTax(net, tax);
  const deposit = computeDeposit(taxed.totalMinor, pkg.deposit);
  const purchasable = pkg.pricingMode === "fixed" && reasons.length === 0;

  return {
    currency: "ZAR",
    lines,
    subtotalMinor: taxed.subtotalMinor,
    taxMinor: taxed.taxMinor,
    totalMinor: taxed.totalMinor,
    depositMinor: deposit,
    dueNowMinor: deposit,
    balanceMinor: taxed.totalMinor - deposit,
    purchasable,
    requiresQuoteReasons: reasons,
  };
}
