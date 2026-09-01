import { parseRupeesToPaise, PricingError } from "./pricing";

/**
 * Product import from a shop's existing price list.
 *
 * Every shop arrives with an Excel sheet, so import is the first thing they do
 * and the first place they form an opinion of the product. It has to survive
 * the real state of those files: BOMs from Excel, "Rs." prefixes, blank filler
 * rows, and header names that vary from shop to shop.
 */

export type ImportRow = {
  name: string;
  categoryName: string | null;
  sku: string | null;
  mrp: number; // paise
  discountPct: number;
  unit: string;
  piecesPerUnit: number | null;
  youtubeUrl: string | null;
};

export type ImportIssue = { line: number; message: string; raw?: string };

export type ImportResult = {
  rows: ImportRow[];
  issues: ImportIssue[];
};

/** Header aliases seen across real Sivakasi price lists. */
const HEADER_ALIASES: Record<string, string> = {
  name: "name",
  product: "name",
  productname: "name",
  item: "name",
  itemname: "name",
  particulars: "name",
  description: "name",

  category: "category",
  categoryname: "category",
  type: "category",
  group: "category",

  sku: "sku",
  code: "sku",
  itemcode: "sku",
  productcode: "sku",

  mrp: "mrp",
  rate: "mrp",
  price: "mrp",
  mrprate: "mrp",
  listprice: "mrp",

  discount: "discount",
  discountpct: "discount",
  disc: "discount",
  offer: "discount",

  unit: "unit",
  uom: "unit",
  per: "unit",

  pieces: "pieces",
  pcs: "pieces",
  qty: "pieces",
  piecesperbox: "pieces",
  content: "pieces",

  youtube: "youtube",
  video: "youtube",
  youtubeurl: "youtube",
};

function canonicalHeader(raw: string): string | null {
  const key = raw
    .replace(/^﻿/, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return HEADER_ALIASES[key] ?? null;
}

/** RFC4180-style splitter: handles quoted fields containing commas and
 *  doubled quotes, which product names ("Lakshmi 4"" Deluxe") really do use. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

export function parseProductCsv(content: string): ImportResult {
  const rows: ImportRow[] = [];
  const issues: ImportIssue[] = [];

  const text = content.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n");

  const headerIndex = lines.findIndex((l) => l.trim() !== "");
  if (headerIndex === -1) {
    return { rows, issues: [{ line: 0, message: "The file is empty." }] };
  }

  const headers = splitCsvLine(lines[headerIndex]).map(canonicalHeader);
  if (!headers.includes("name")) {
    return {
      rows,
      issues: [
        {
          line: headerIndex + 1,
          message:
            "Could not find a product name column. Expected a header such as Name, Product, or Item.",
        },
      ],
    };
  }
  if (!headers.includes("mrp")) {
    return {
      rows,
      issues: [
        {
          line: headerIndex + 1,
          message: "Could not find a price column. Expected a header such as MRP, Rate, or Price.",
        },
      ],
    };
  }

  const seenSkus = new Set<string>();

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine.trim() === "") continue;

    const cells = splitCsvLine(rawLine);
    const get = (key: string): string => {
      const idx = headers.indexOf(key);
      return idx === -1 ? "" : (cells[idx] ?? "");
    };

    const name = get("name");

    // Price lists are full of section banners ("--- FLOWER POTS ---") sitting
    // in the name column with every other cell blank. A row with no name, or
    // with a name but no price, is one of those. Skip it quietly rather than
    // reporting dozens of errors on a perfectly valid file.
    if (name === "" || get("mrp") === "") continue;

    let mrp: number;
    try {
      mrp = parseRupeesToPaise(get("mrp"));
    } catch (err) {
      issues.push({
        line: i + 1,
        message: `Could not read the price "${get("mrp")}".`,
        raw: rawLine,
      });
      continue;
    }
    if (mrp <= 0) {
      issues.push({ line: i + 1, message: "Price must be greater than zero.", raw: rawLine });
      continue;
    }

    const discountRaw = get("discount").replace("%", "").trim();
    let discountPct = 0;
    if (discountRaw !== "") {
      const parsed = Number(discountRaw);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        issues.push({
          line: i + 1,
          message: `Discount must be between 0 and 100, got "${get("discount")}".`,
          raw: rawLine,
        });
        continue;
      }
      discountPct = Math.round(parsed);
    }

    const sku = get("sku") || null;
    if (sku) {
      if (seenSkus.has(sku)) {
        issues.push({ line: i + 1, message: `Duplicate SKU "${sku}" in this file.`, raw: rawLine });
        continue;
      }
      seenSkus.add(sku);
    }

    const piecesRaw = get("pieces");
    let piecesPerUnit: number | null = null;
    if (piecesRaw !== "") {
      const n = Number(piecesRaw.replace(/[^\d.]/g, ""));
      piecesPerUnit = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    }

    rows.push({
      name,
      categoryName: get("category") || null,
      sku,
      mrp,
      discountPct,
      unit: get("unit") || "box",
      piecesPerUnit,
      youtubeUrl: get("youtube") || null,
    });
  }

  if (rows.length === 0 && issues.length === 0) {
    issues.push({ line: 0, message: "No product rows found in the file." });
  }

  return { rows, issues };
}
