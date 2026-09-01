import { sql, eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { products, orders, orderItems, tenants } from "../db/schema";
import { priceCart, checkMinOrderValue, type CartLineInput } from "./pricing";

export class OrderError extends Error {
  constructor(
    message: string,
    public code:
      | "EMPTY_CART"
      | "BELOW_MINIMUM"
      | "UNKNOWN_PRODUCT"
      | "INACTIVE_PRODUCT"
      | "INSUFFICIENT_STOCK"
      | "VALIDATION",
    public details?: unknown,
  ) {
    super(message);
  }
}

/**
 * What the storefront is allowed to submit.
 *
 * Note what is absent: prices. The client sends product ids and quantities
 * only, and the server re-derives every price from the database. Accepting a
 * price from the browser is how you end up shipping a Rs 40,000 order that
 * was posted as Rs 1.
 */
export const checkoutSchema = z.object({
  customerName: z.string().trim().min(2).max(120),
  customerPhone: z
    .string()
    .trim()
    .regex(/^(\+91[\s-]?)?[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"),
  customerEmail: z.string().trim().email().optional().or(z.literal("")),
  addressLine: z.string().trim().min(5).max(500),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, "Enter a valid 6-digit PIN code"),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(0).max(9999),
      }),
    )
    .min(1),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export type PlacedOrder = {
  orderId: string;
  orderNumber: number;
  estimateNumber: string;
  subtotal: number;
  totalSavings: number;
  itemCount: number;
};

/**
 * Creates an order and its estimate from a storefront submission.
 *
 * Must be called inside `withTenant`, so RLS scopes every statement to the
 * shop whose storefront was used.
 */
export async function placeOrder(
  tx: any,
  tenantId: string,
  raw: unknown,
): Promise<PlacedOrder> {
  const parsed = checkoutSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OrderError("Please check the details entered.", "VALIDATION", parsed.error.flatten());
  }
  const input = parsed.data;

  const requested = input.items.filter((i) => i.quantity > 0);
  if (requested.length === 0) {
    throw new OrderError("Your cart is empty.", "EMPTY_CART");
  }

  // Collapse duplicate rows for the same product rather than creating two
  // lines; the bulk table can legitimately submit a product twice if a shop
  // lists it under two categories.
  const quantities = new Map<string, number>();
  for (const item of requested) {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }

  const ids = [...quantities.keys()];
  const found = await tx.select().from(products).where(inArray(products.id, ids));

  if (found.length !== ids.length) {
    const foundIds = new Set(found.map((p: any) => p.id));
    throw new OrderError(
      "Some items are no longer available. Please refresh and try again.",
      "UNKNOWN_PRODUCT",
      { missing: ids.filter((id) => !foundIds.has(id)) },
    );
  }

  const inactive = found.filter((p: any) => !p.isActive);
  if (inactive.length > 0) {
    throw new OrderError(
      `${inactive.map((p: any) => p.name).join(", ")} is no longer available.`,
      "INACTIVE_PRODUCT",
      { products: inactive.map((p: any) => p.id) },
    );
  }

  const cartLines: CartLineInput[] = found.map((p: any) => ({
    productId: p.id,
    productName: p.name,
    unit: p.unit,
    mrp: p.mrp,
    discountPct: p.discountPct,
    quantity: quantities.get(p.id)!,
  }));

  // Stock is optional per product (NULL means untracked).
  const short = found.filter(
    (p: any) => p.stock !== null && p.stock < quantities.get(p.id)!,
  );
  if (short.length > 0) {
    throw new OrderError(
      `Not enough stock for ${short.map((p: any) => p.name).join(", ")}.`,
      "INSUFFICIENT_STOCK",
      { products: short.map((p: any) => ({ id: p.id, available: p.stock })) },
    );
  }

  const cart = priceCart(cartLines);

  const [shop] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
  const minCheck = checkMinOrderValue(cart.subtotal, shop?.minOrderValue ?? 0);
  if (!minCheck.ok) {
    throw new OrderError(minCheck.message, "BELOW_MINIMUM", {
      shortfall: minCheck.shortfall,
      required: minCheck.required,
    });
  }

  const orderNumber = await nextOrderNumber(tx, tenantId);

  const [order] = await tx
    .insert(orders)
    .values({
      tenantId,
      orderNumber,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerEmail: input.customerEmail || null,
      addressLine: input.addressLine,
      city: input.city,
      state: input.state,
      pincode: input.pincode,
      notes: input.notes || null,
      subtotal: cart.subtotal,
      status: "pending",
    })
    .returning();

  await tx.insert(orderItems).values(
    cart.lines.map((l) => ({
      tenantId,
      orderId: order.id,
      productId: l.productId,
      productName: l.productName,
      unit: l.unit,
      mrp: l.mrp,
      discountPct: l.discountPct,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      lineTotal: l.lineTotal,
    })),
  );

  // Decrement tracked stock only.
  for (const p of found.filter((p: any) => p.stock !== null)) {
    await tx
      .update(products)
      .set({ stock: sql`${products.stock} - ${quantities.get(p.id)!}` })
      .where(eq(products.id, p.id));
  }

  return {
    orderId: order.id,
    orderNumber,
    estimateNumber: formatEstimateNumber(orderNumber),
    subtotal: cart.subtotal,
    totalSavings: cart.totalSavings,
    itemCount: cart.itemCount,
  };
}

/**
 * Per-tenant sequential estimate numbers.
 *
 * A plain `max(order_number) + 1` races: two customers checking out in the
 * same second both read the same max and one insert dies on the unique index.
 * A transaction-scoped advisory lock keyed on the tenant serialises numbering
 * per shop without blocking other shops.
 */
async function nextOrderNumber(tx: any, tenantId: string): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"order_no:" + tenantId}))`);
  const result: any = await tx.execute(
    sql`select coalesce(max(${orders.orderNumber}), 0) + 1 as next from ${orders}`,
  );
  const rows = result.rows ?? result;
  return Number(rows[0].next);
}

export function formatEstimateNumber(orderNumber: number): string {
  return `EST-${String(orderNumber).padStart(4, "0")}`;
}

/** Marks an order paid after the shop confirms a UPI or bank transfer. */
export async function markOrderPaid(
  tx: any,
  orderId: string,
  paymentRef: string,
): Promise<void> {
  const ref = paymentRef.trim();
  if (ref.length < 3) {
    throw new OrderError("Enter the UPI or bank reference number.", "VALIDATION");
  }
  await tx
    .update(orders)
    .set({ status: "paid", paymentRef: ref, paidAt: new Date(), updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.status, "pending")));
}
