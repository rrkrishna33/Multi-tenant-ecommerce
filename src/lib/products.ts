import { z } from "zod";
import { parseRupeesToPaise, PricingError } from "./pricing";

/**
 * Validation for products created by hand in the shop admin.
 *
 * Shops think and type in rupees ("500", "1,250.50", "Rs. 300"), so prices are
 * accepted in that shape and converted to integer paise here. The database
 * never sees a rupee string and the UI never sees paise.
 */

export class ProductError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
  }
}

export const UNITS = ["box", "packet", "piece", "bundle", "pair", "set"] as const;
export type Unit = (typeof UNITS)[number];

/** Blank optional text arrives from a form as "", which should mean null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v));

/**
 * Only accepts real YouTube links.
 *
 * The stored value is rendered as an href on the public storefront, so an
 * unvalidated field here is an open redirect at best and a `javascript:` URL
 * at worst -- placed by whoever has access to the shop admin, shown to the
 * shop's own customers.
 */
export function normaliseYoutubeUrl(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;

  let url: URL;
  try {
    url = new URL(value.startsWith("http") ? value : `https://${value}`);
  } catch {
    throw new ProductError("Enter a valid YouTube link.", "youtubeUrl");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProductError("Enter a valid YouTube link.", "youtubeUrl");
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let id: string | null = null;

  if (host === "youtube.com" || host === "m.youtube.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else if (url.pathname.startsWith("/shorts/")) id = url.pathname.slice(8).split("/")[0];
    else if (url.pathname.startsWith("/embed/")) id = url.pathname.slice(7).split("/")[0];
  } else if (host === "youtu.be") {
    id = url.pathname.slice(1).split("/")[0];
  }

  if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
    throw new ProductError("That does not look like a YouTube video link.", "youtubeUrl");
  }

  return `https://www.youtube.com/watch?v=${id}`;
}

export const productFormSchema = z.object({
  name: z.string().trim().min(2, "Enter the product name.").max(200),
  nameTa: optionalText(200),
  sku: optionalText(60),
  description: optionalText(2000),
  categoryId: optionalText(64),
  newCategory: optionalText(120),
  mrp: z.string().trim().min(1, "Enter the MRP."),
  discountPct: z.coerce
    .number({ invalid_type_error: "Discount must be a number." })
    .int("Discount must be a whole number.")
    .min(0, "Discount cannot be negative.")
    .max(100, "Discount cannot be more than 100%."),
  unit: z.enum(UNITS),
  piecesPerUnit: optionalText(10),
  stock: optionalText(10),
  isActive: z.boolean().optional().default(true),
  youtubeUrl: optionalText(300),
});

export type ProductInput = {
  name: string;
  nameTa: string | null;
  sku: string | null;
  description: string | null;
  categoryId: string | null;
  newCategory: string | null;
  mrp: number; // paise
  discountPct: number;
  unit: Unit;
  piecesPerUnit: number | null;
  stock: number | null;
  isActive: boolean;
  youtubeUrl: string | null;
};

function optionalCount(raw: string | null, field: string, label: string): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new ProductError(`${label} must be a whole number, or left blank.`, field);
  }
  return n;
}

/** Parses and validates a submitted product form into database-ready values. */
export function parseProductForm(raw: unknown): ProductInput {
  const parsed = productFormSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ProductError(issue.message, String(issue.path[0] ?? ""));
  }
  const v = parsed.data;

  let mrp: number;
  try {
    mrp = parseRupeesToPaise(v.mrp);
  } catch (err) {
    if (err instanceof PricingError) {
      throw new ProductError(`"${v.mrp}" is not a valid price.`, "mrp");
    }
    throw err;
  }
  if (mrp <= 0) throw new ProductError("MRP must be more than zero.", "mrp");

  // A price above a lakh per box is far more likely a typo (an extra zero, or
  // paise typed as rupees) than a real product, and a wrong price on a
  // storefront during Diwali is expensive in both directions.
  if (mrp > 100_000_00) {
    throw new ProductError("That price looks too high. Enter the price in rupees.", "mrp");
  }

  return {
    name: v.name,
    nameTa: v.nameTa,
    sku: v.sku,
    description: v.description,
    categoryId: v.categoryId,
    newCategory: v.newCategory,
    mrp,
    discountPct: v.discountPct,
    unit: v.unit,
    piecesPerUnit: optionalCount(v.piecesPerUnit, "piecesPerUnit", "Pieces per unit"),
    stock: optionalCount(v.stock, "stock", "Stock"),
    isActive: v.isActive ?? true,
    youtubeUrl: v.youtubeUrl ? normaliseYoutubeUrl(v.youtubeUrl) : null,
  };
}
