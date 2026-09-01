import { describe, it, expect } from "vitest";
import {
  salePrice,
  priceCart,
  checkMinOrderValue,
  formatInr,
  parseRupeesToPaise,
  PricingError,
} from "../src/lib/pricing";

describe("salePrice", () => {
  it("applies a percentage discount to MRP", () => {
    expect(salePrice(50000, 80)).toBe(10000); // Rs 500 at 80% off -> Rs 100
    expect(salePrice(30000, 75)).toBe(7500);
  });

  it("handles the no-discount and free ends", () => {
    expect(salePrice(12345, 0)).toBe(12345);
    expect(salePrice(12345, 100)).toBe(0);
  });

  it("rounds to whole paise rather than producing fractions", () => {
    // 333 paise at 67% off = 109.89 paise
    expect(salePrice(333, 67)).toBe(110);
    expect(Number.isInteger(salePrice(333, 67))).toBe(true);
  });

  it("rejects invalid inputs instead of silently producing NaN", () => {
    expect(() => salePrice(-1, 10)).toThrow(PricingError);
    expect(() => salePrice(100.5, 10)).toThrow(PricingError);
    expect(() => salePrice(100, 101)).toThrow(PricingError);
    expect(() => salePrice(100, -5)).toThrow(PricingError);
  });
});

describe("priceCart", () => {
  const line = (over: Partial<any> = {}) => ({
    productId: "p1",
    productName: "Flower Pot Big",
    unit: "box",
    mrp: 50000,
    discountPct: 80,
    quantity: 2,
    ...over,
  });

  it("prices lines and totals the cart", () => {
    const cart = priceCart([line(), line({ productId: "p2", mrp: 30000, quantity: 1 })]);
    expect(cart.lines).toHaveLength(2);
    expect(cart.lines[0].unitPrice).toBe(10000);
    expect(cart.lines[0].lineTotal).toBe(20000);
    expect(cart.subtotal).toBe(20000 + 6000);
    expect(cart.itemCount).toBe(3);
  });

  it("reports MRP savings, which is the headline number on these sites", () => {
    const cart = priceCart([line()]);
    expect(cart.totalMrp).toBe(100000);
    expect(cart.totalSavings).toBe(80000);
  });

  it("drops zero-quantity rows, since the bulk table posts the whole catalogue", () => {
    const cart = priceCart([line({ quantity: 0 }), line({ productId: "p2", quantity: 3 })]);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].productId).toBe("p2");
  });

  it("returns an empty cart for an all-blank submission", () => {
    const cart = priceCart([line({ quantity: 0 }), line({ productId: "p2", quantity: 0 })]);
    expect(cart.lines).toHaveLength(0);
    expect(cart.subtotal).toBe(0);
    expect(cart.totalSavings).toBe(0);
  });

  it("rejects negative and fractional quantities", () => {
    expect(() => priceCart([line({ quantity: -1 })])).toThrow(PricingError);
    expect(() => priceCart([line({ quantity: 1.5 })])).toThrow(PricingError);
  });

  it("stays exact on a large realistic Diwali order", () => {
    // 60 distinct items, the sort of order the bulk table exists for.
    const lines = Array.from({ length: 60 }, (_, i) =>
      line({ productId: `p${i}`, mrp: 33300 + i, discountPct: 67, quantity: (i % 7) + 1 }),
    );
    const cart = priceCart(lines);
    expect(Number.isInteger(cart.subtotal)).toBe(true);
    // Recomputing independently must agree exactly.
    const expected = lines.reduce(
      (sum, l) => sum + Math.round((l.mrp * 33) / 100) * l.quantity,
      0,
    );
    expect(cart.subtotal).toBe(expected);
  });
});

describe("checkMinOrderValue", () => {
  it("passes at or above the threshold", () => {
    expect(checkMinOrderValue(250000, 250000).ok).toBe(true);
    expect(checkMinOrderValue(300000, 250000).ok).toBe(true);
  });

  it("reports the exact shortfall below the threshold", () => {
    const result = checkMinOrderValue(180000, 250000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.shortfall).toBe(70000);
      expect(result.message).toContain("Rs. 700.00");
    }
  });
});

describe("formatInr", () => {
  it("uses Indian digit grouping, not thousands grouping", () => {
    expect(formatInr(100)).toBe("Rs. 1.00");
    expect(formatInr(99999)).toBe("Rs. 999.99");
    expect(formatInr(100000)).toBe("Rs. 1,000.00");
    expect(formatInr(10000000)).toBe("Rs. 1,00,000.00");
    expect(formatInr(1234567890)).toBe("Rs. 1,23,45,678.90");
  });

  it("pads paise and handles negatives", () => {
    expect(formatInr(105)).toBe("Rs. 1.05");
    expect(formatInr(-25000)).toBe("-Rs. 250.00");
  });
});

describe("parseRupeesToPaise", () => {
  it("parses the formats that appear in shop price lists", () => {
    expect(parseRupeesToPaise("500")).toBe(50000);
    expect(parseRupeesToPaise("1,250.50")).toBe(125050);
    expect(parseRupeesToPaise("Rs. 300")).toBe(30000);
    expect(parseRupeesToPaise("₹ 99.99")).toBe(9999);
    expect(parseRupeesToPaise(250)).toBe(25000);
  });

  it("rejects junk rather than importing a NaN price", () => {
    expect(() => parseRupeesToPaise("")).toThrow(PricingError);
    expect(() => parseRupeesToPaise("N/A")).toThrow(PricingError);
    expect(() => parseRupeesToPaise("12.3.4")).toThrow(PricingError);
  });
});
