import { describe, expect, it } from "vitest";
import { allocateByBps, applyBps, computeDeposit, computeTax, parseMajorToMinor, roundToStep, formatMoney } from "../src/money";

describe("money", () => {
  it("applies basis points with half-up rounding using integer maths", () => {
    expect(applyBps(10_000, 1500)).toBe(1500);
    expect(applyBps(333, 5000)).toBe(167); // 166.5 -> 167
    expect(applyBps(-333, 5000)).toBe(-167);
    expect(applyBps(999_999_999_999, 9999)).toBe(999_899_999_999);
  });

  it("rejects non-integer amounts", () => {
    expect(() => applyBps(10.5, 100)).toThrow(RangeError);
  });

  it("rounds to configured steps", () => {
    expect(roundToStep(12_349_999, 100_000)).toBe(12_300_000);
    expect(roundToStep(12_350_000, 100_000)).toBe(12_400_000);
    expect(roundToStep(123, 1)).toBe(123);
  });

  it("allocates exactly with remainder on the last part", () => {
    const parts = allocateByBps(100_001, [3333, 3333, 3334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100_001);
    expect(allocateByBps(1000, [5000, 3000, 2000])).toEqual([500, 300, 200]);
  });

  it("computes tax only when enabled", () => {
    expect(computeTax(10_000, { enabled: false, rateBps: 1500, label: "VAT", pricesIncludeTax: false })).toEqual({ subtotalMinor: 10_000, taxMinor: 0, totalMinor: 10_000 });
    expect(computeTax(10_000, { enabled: true, rateBps: 1500, label: "VAT", pricesIncludeTax: false })).toEqual({ subtotalMinor: 10_000, taxMinor: 1500, totalMinor: 11_500 });
    expect(computeTax(11_500, { enabled: true, rateBps: 1500, label: "VAT", pricesIncludeTax: true })).toEqual({ subtotalMinor: 10_000, taxMinor: 1500, totalMinor: 11_500 });
  });

  it("computes deposits", () => {
    expect(computeDeposit(100_000, { type: "percent", percentBps: 5000 })).toBe(50_000);
    expect(computeDeposit(100_000, { type: "fixed", amountMinor: 200_000 })).toBe(100_000);
    expect(computeDeposit(100_000, { type: "full" })).toBe(100_000);
    expect(computeDeposit(100_000, { type: "none" })).toBe(0);
  });

  it("parses user-entered rand amounts", () => {
    expect(parseMajorToMinor("R 12 500,50")).toBe(1_250_050);
    expect(parseMajorToMinor("12500.5")).toBe(1_250_050);
    expect(parseMajorToMinor("1,000")).toBe(100_000);
    expect(parseMajorToMinor(99.99)).toBe(9999);
  });

  it("formats ZAR", () => {
    expect(formatMoney(1_250_000)).toMatch(/R\s?12\s?500/);
  });
});
