import { describe, it, expect } from "vitest";
import { parseProductCsv, splitCsvLine } from "../src/lib/csv-import";

describe("splitCsvLine", () => {
  it("splits plain fields and trims whitespace", () => {
    expect(splitCsvLine("a, b ,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(splitCsvLine('"Lakshmi, Deluxe",100')).toEqual(["Lakshmi, Deluxe", "100"]);
  });

  it("handles doubled quotes inside a quoted field", () => {
    // Product names really do contain inch marks: Lakshmi 4" Deluxe
    expect(splitCsvLine('"Lakshmi 4"" Deluxe",100')).toEqual(['Lakshmi 4" Deluxe', "100"]);
  });

  it("preserves empty trailing fields", () => {
    expect(splitCsvLine("a,,c,")).toEqual(["a", "", "c", ""]);
  });
});

describe("parseProductCsv", () => {
  it("parses a standard price list", () => {
    const csv = [
      "Name,Category,MRP,Discount,Unit,Pieces",
      "Flower Pot Big,Flower Pots,500,80,box,10",
      "Sparklers 15cm,Sparklers,120,75,packet,50",
    ].join("\n");

    const { rows, issues } = parseProductCsv(csv);
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "Flower Pot Big",
      categoryName: "Flower Pots",
      mrp: 50000,
      discountPct: 80,
      unit: "box",
      piecesPerUnit: 10,
    });
  });

  it("accepts the header names different shops actually use", () => {
    const csv = ["Particulars,Rate,Disc,Per", "Ground Chakkar,250,70,box"].join("\n");
    const { rows, issues } = parseProductCsv(csv);
    expect(issues).toEqual([]);
    expect(rows[0]).toMatchObject({ name: "Ground Chakkar", mrp: 25000, discountPct: 70 });
  });

  it("strips the UTF-8 BOM that Excel writes", () => {
    const csv = "﻿Name,MRP\nAtom Bomb,300";
    const { rows, issues } = parseProductCsv(csv);
    expect(issues).toEqual([]);
    expect(rows[0].name).toBe("Atom Bomb");
  });

  it("handles Windows line endings", () => {
    const { rows } = parseProductCsv("Name,MRP\r\nRocket,150\r\nBomb,200\r\n");
    expect(rows).toHaveLength(2);
  });

  it("reads rupee formatting from the sheet", () => {
    const csv = ["Name,MRP", "Deluxe Gift Box,\"Rs. 1,250.50\""].join("\n");
    const { rows } = parseProductCsv(csv);
    expect(rows[0].mrp).toBe(125050);
  });

  it("accepts a discount written with a percent sign", () => {
    const { rows } = parseProductCsv("Name,MRP,Discount\nRocket,100,80%");
    expect(rows[0].discountPct).toBe(80);
  });

  it("skips section banner rows without reporting them as errors", () => {
    const csv = [
      "Name,MRP,Discount",
      "--- FLOWER POTS ---,,",
      "Flower Pot Big,500,80",
      "",
      "--- SPARKLERS ---,,",
      "Sparklers 15cm,120,75",
    ].join("\n");

    const { rows, issues } = parseProductCsv(csv);
    expect(issues).toEqual([]);
    expect(rows.map((r) => r.name)).toEqual(["Flower Pot Big", "Sparklers 15cm"]);
  });

  it("defaults the unit to box and discount to zero", () => {
    const { rows } = parseProductCsv("Name,MRP\nRocket,150");
    expect(rows[0].unit).toBe("box");
    expect(rows[0].discountPct).toBe(0);
    expect(rows[0].piecesPerUnit).toBeNull();
  });

  it("reports a bad price on the right line and keeps importing the rest", () => {
    const csv = [
      "Name,MRP",
      "Good One,500",
      "Bad One,N/A",
      "Another Good,300",
    ].join("\n");

    const { rows, issues } = parseProductCsv(csv);
    expect(rows.map((r) => r.name)).toEqual(["Good One", "Another Good"]);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(3);
    expect(issues[0].message).toContain("N/A");
  });

  it("rejects an out-of-range discount", () => {
    const { rows, issues } = parseProductCsv("Name,MRP,Discount\nRocket,150,120");
    expect(rows).toHaveLength(0);
    expect(issues[0].message).toContain("between 0 and 100");
  });

  it("rejects a zero or negative price", () => {
    const { issues } = parseProductCsv("Name,MRP\nFreebie,0");
    expect(issues[0].message).toContain("greater than zero");
  });

  it("flags duplicate SKUs within the file", () => {
    const csv = ["Name,Code,MRP", "A,FP01,100", "B,FP01,200"].join("\n");
    const { rows, issues } = parseProductCsv(csv);
    expect(rows).toHaveLength(1);
    expect(issues[0].message).toContain("Duplicate SKU");
  });

  it("explains a missing name column instead of failing silently", () => {
    const { rows, issues } = parseProductCsv("Price,Discount\n100,80");
    expect(rows).toHaveLength(0);
    expect(issues[0].message).toContain("product name column");
  });

  it("explains a missing price column", () => {
    const { issues } = parseProductCsv("Name,Category\nRocket,Aerial");
    expect(issues[0].message).toContain("price column");
  });

  it("handles an empty file", () => {
    expect(parseProductCsv("").issues[0].message).toContain("empty");
    expect(parseProductCsv("   \n\n").issues[0].message).toContain("empty");
  });

  it("reports a header-only file as having no products", () => {
    const { rows, issues } = parseProductCsv("Name,MRP");
    expect(rows).toHaveLength(0);
    expect(issues[0].message).toContain("No product rows");
  });
});
