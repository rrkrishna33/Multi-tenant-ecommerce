import { describe, it, expect } from "vitest";
import { parseProductForm, normaliseYoutubeUrl, ProductError } from "../src/lib/products";

const form = (over: Record<string, unknown> = {}) => ({
  name: "Flower Pot Big",
  mrp: "500",
  discountPct: "80",
  unit: "box",
  ...over,
});

describe("parseProductForm", () => {
  it("converts a rupee price to integer paise", () => {
    expect(parseProductForm(form()).mrp).toBe(50000);
    expect(parseProductForm(form({ mrp: "1,250.50" })).mrp).toBe(125050);
    expect(parseProductForm(form({ mrp: "Rs. 300" })).mrp).toBe(30000);
    expect(parseProductForm(form({ mrp: "₹99.99" })).mrp).toBe(9999);
  });

  it("coerces the discount from a form string", () => {
    const p = parseProductForm(form({ discountPct: "75" }));
    expect(p.discountPct).toBe(75);
    expect(Number.isInteger(p.discountPct)).toBe(true);
  });

  it("turns blank optional fields into null rather than empty strings", () => {
    const p = parseProductForm(
      form({ nameTa: "", sku: "", description: "", youtubeUrl: "", stock: "", piecesPerUnit: "" }),
    );
    expect(p.nameTa).toBeNull();
    expect(p.sku).toBeNull();
    expect(p.description).toBeNull();
    expect(p.youtubeUrl).toBeNull();
    expect(p.stock).toBeNull(); // null means untracked, not zero
    expect(p.piecesPerUnit).toBeNull();
  });

  it("keeps a stock of zero distinct from untracked stock", () => {
    expect(parseProductForm(form({ stock: "0" })).stock).toBe(0);
    expect(parseProductForm(form({ stock: "" })).stock).toBeNull();
  });

  it("keeps Tamil names", () => {
    const p = parseProductForm(form({ nameTa: "பூச்சட்டி" }));
    expect(p.nameTa).toBe("பூச்சட்டி");
  });

  it("trims surrounding whitespace", () => {
    expect(parseProductForm(form({ name: "  Flower Pot Big  " })).name).toBe("Flower Pot Big");
  });

  it("defaults to active", () => {
    expect(parseProductForm(form()).isActive).toBe(true);
    expect(parseProductForm(form({ isActive: false })).isActive).toBe(false);
  });

  describe("rejections", () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["a one-character name", { name: "X" }, "name"],
      ["a missing price", { mrp: "" }, "mrp"],
      ["a non-numeric price", { mrp: "ask us" }, "mrp"],
      ["a zero price", { mrp: "0" }, "mrp"],
      ["a negative price", { mrp: "-100" }, "mrp"],
      ["a discount above 100", { discountPct: "120" }, "discountPct"],
      ["a negative discount", { discountPct: "-5" }, "discountPct"],
      ["a fractional discount", { discountPct: "12.5" }, "discountPct"],
      ["a non-numeric discount", { discountPct: "eighty" }, "discountPct"],
      ["an unknown unit", { unit: "kilogram" }, "unit"],
      ["fractional pieces", { piecesPerUnit: "2.5" }, "piecesPerUnit"],
      ["negative stock", { stock: "-3" }, "stock"],
    ];

    for (const [label, override, field] of cases) {
      it(`rejects ${label}`, () => {
        try {
          parseProductForm(form(override));
          throw new Error("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(ProductError);
          expect((err as ProductError).field).toBe(field);
        }
      });
    }

    it("rejects a price that is almost certainly a typo", () => {
      // Rs 5,00,000 for one box is an extra zero, or paise typed as rupees.
      // A wrong price on a live storefront during Diwali is expensive whichever
      // direction it is wrong in.
      try {
        parseProductForm(form({ mrp: "500000" }));
        throw new Error("should have thrown");
      } catch (err) {
        expect((err as ProductError).field).toBe("mrp");
        expect((err as ProductError).message).toContain("too high");
      }
    });

    it("accepts a legitimately expensive gift box", () => {
      expect(parseProductForm(form({ mrp: "9500" })).mrp).toBe(950000);
    });
  });
});

describe("normaliseYoutubeUrl", () => {
  const ID = "dQw4w9WgXcQ";
  const canonical = `https://www.youtube.com/watch?v=${ID}`;

  it("accepts the link shapes shops actually paste", () => {
    for (const input of [
      `https://www.youtube.com/watch?v=${ID}`,
      `http://youtube.com/watch?v=${ID}`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `youtube.com/watch?v=${ID}`,
    ]) {
      expect(normaliseYoutubeUrl(input)).toBe(canonical);
    }
  });

  it("normalises away tracking and playlist parameters", () => {
    expect(normaliseYoutubeUrl(`https://youtu.be/${ID}?si=abc123&t=42`)).toBe(canonical);
    expect(normaliseYoutubeUrl(`https://www.youtube.com/watch?v=${ID}&list=PLxyz`)).toBe(canonical);
  });

  it("treats blank as no video", () => {
    expect(normaliseYoutubeUrl("")).toBeNull();
    expect(normaliseYoutubeUrl("   ")).toBeNull();
  });

  it("refuses a javascript: URL", () => {
    // This value is rendered as an href on the public storefront. Without this
    // check, whoever has shop-admin access gets script execution against the
    // shop's own customers.
    expect(() => normaliseYoutubeUrl("javascript:alert(document.cookie)")).toThrow(ProductError);
    expect(() => normaliseYoutubeUrl("JavaScript:alert(1)")).toThrow(ProductError);
    expect(() => normaliseYoutubeUrl("data:text/html,<script>alert(1)</script>")).toThrow(
      ProductError,
    );
  });

  it("refuses a non-YouTube host, including lookalikes", () => {
    for (const bad of [
      "https://example.com/watch?v=abc123",
      "https://notyoutube.com/watch?v=abc123",
      "https://youtube.com.evil.test/watch?v=abc123",
      "https://vimeo.com/12345678",
    ]) {
      expect(() => normaliseYoutubeUrl(bad)).toThrow(ProductError);
    }
  });

  it("refuses a YouTube URL with no video id", () => {
    expect(() => normaliseYoutubeUrl("https://www.youtube.com/")).toThrow(ProductError);
    expect(() => normaliseYoutubeUrl("https://www.youtube.com/watch")).toThrow(ProductError);
    expect(() => normaliseYoutubeUrl("https://youtu.be/")).toThrow(ProductError);
  });

  it("refuses junk that is not a URL at all", () => {
    expect(() => normaliseYoutubeUrl("not a link")).toThrow(ProductError);
  });
});
