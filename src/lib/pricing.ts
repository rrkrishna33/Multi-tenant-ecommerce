/**
 * Money helpers. Every amount in this module is INTEGER PAISE.
 *
 * The whole catalogue is priced as "MRP minus a discount percentage", which is
 * how crackers are advertised locally ("90% OFF"). Sale price is always derived
 * here so the storefront, the cart, and the estimate PDF can never disagree.
 */

export const RUPEE = 100;

export class PricingError extends Error {}

/** Sale price for one unit, derived from MRP and discount. */
export function salePrice(mrp: number, discountPct: number): number {
  if (!Number.isInteger(mrp) || mrp < 0) {
    throw new PricingError(`mrp must be a non-negative integer in paise, got ${mrp}`);
  }
  if (!Number.isInteger(discountPct) || discountPct < 0 || discountPct > 100) {
    throw new PricingError(`discountPct must be an integer 0..100, got ${discountPct}`);
  }
  // Multiply before dividing so the rounding happens once, at the end.
  return Math.round((mrp * (100 - discountPct)) / 100);
}

export function lineTotal(unitPrice: number, quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new PricingError(`quantity must be a non-negative integer, got ${quantity}`);
  }
  return unitPrice * quantity;
}

export type CartLineInput = {
  productId: string;
  productName: string;
  unit: string;
  mrp: number;
  discountPct: number;
  quantity: number;
};

export type PricedLine = CartLineInput & {
  unitPrice: number;
  lineTotal: number;
};

export type PricedCart = {
  lines: PricedLine[];
  subtotal: number;
  totalMrp: number;
  totalSavings: number;
  itemCount: number;
};

/**
 * Prices a whole cart. Zero-quantity lines are dropped rather than rejected:
 * the bulk order table posts every row in the catalogue, and the vast majority
 * of them are legitimately left blank.
 */
export function priceCart(lines: CartLineInput[]): PricedCart {
  const priced: PricedLine[] = [];

  for (const line of lines) {
    if (line.quantity === 0) continue;
    const unitPrice = salePrice(line.mrp, line.discountPct);
    priced.push({
      ...line,
      unitPrice,
      lineTotal: lineTotal(unitPrice, line.quantity),
    });
  }

  const subtotal = priced.reduce((sum, l) => sum + l.lineTotal, 0);
  const totalMrp = priced.reduce((sum, l) => sum + l.mrp * l.quantity, 0);

  return {
    lines: priced,
    subtotal,
    totalMrp,
    totalSavings: totalMrp - subtotal,
    itemCount: priced.reduce((sum, l) => sum + l.quantity, 0),
  };
}

export type MinOrderCheck =
  | { ok: true }
  | { ok: false; shortfall: number; required: number; message: string };

/** Shops enforce a minimum order value because licensed road transport makes
 *  small consignments uneconomic. Checked server-side; the client hint is only
 *  a convenience. */
export function checkMinOrderValue(subtotal: number, minOrderValue: number): MinOrderCheck {
  if (subtotal >= minOrderValue) return { ok: true };
  const shortfall = minOrderValue - subtotal;
  return {
    ok: false,
    shortfall,
    required: minOrderValue,
    message: `Minimum order value is ${formatInr(minOrderValue)}. Please add ${formatInr(
      shortfall,
    )} more to place this order.`,
  };
}

/** Formats paise as Indian-grouped rupees: 1234567890 -> "Rs. 1,23,45,678.90" */
export function formatInr(paise: number, opts: { symbol?: string } = {}): string {
  const symbol = opts.symbol ?? "Rs.";
  const negative = paise < 0;
  const abs = Math.abs(paise);

  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;

  const digits = String(rupees);
  let grouped: string;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    // Indian grouping: last three digits, then pairs.
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3);
    grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  }

  const body = `${grouped}.${String(fraction).padStart(2, "0")}`;
  return `${negative ? "-" : ""}${symbol} ${body}`;
}

/** Parses a rupee string from a shop's price list into integer paise. */
export function parseRupeesToPaise(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new PricingError(`Not a valid amount: ${input}`);
    return Math.round(input * 100);
  }
  const cleaned = input.replace(/[\s,]/g, "").replace(/^(Rs\.?|INR|₹)/i, "");
  if (cleaned === "" || !/^-?\d*(\.\d+)?$/.test(cleaned)) {
    throw new PricingError(`Not a valid amount: ${input}`);
  }
  return Math.round(Number(cleaned) * 100);
}
