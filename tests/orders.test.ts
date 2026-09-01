import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, seedTenant, schema, type TestDb } from "./helpers/db";
import { withTenant } from "../src/db";
import { placeOrder, markOrderPaid, OrderError, formatEstimateNumber } from "../src/lib/orders";

let t: TestDb;
let shopA: string;
let shopB: string;
let bigBox: string;
let smallBox: string;
let shopBProduct: string;

const validCustomer = {
  customerName: "Ravi Kumar",
  customerPhone: "9842012345",
  addressLine: "12 Anna Nagar, Main Road",
  city: "Madurai",
  state: "Tamil Nadu",
  pincode: "625001",
};

beforeAll(async () => {
  t = await createTestDb();
});

beforeEach(async () => {
  // Truncating is far cheaper than standing up a fresh Postgres per test.
  await t.db.execute(sql`truncate table tenants cascade`);

  // Shop A minimum Rs 300; a two-box order of Flower Pot Big (Rs 200 each)
  // clears it, while a single packet of sparklers (Rs 50) does not.
  shopA = await seedTenant(t, { slug: "anil", minOrderValue: 30000 });
  shopB = await seedTenant(t, { slug: "murugan", minOrderValue: 100000 });

  const inserted = await t.db
    .insert(schema.products)
    .values([
      { tenantId: shopA, name: "Flower Pot Big", mrp: 100000, discountPct: 80, unit: "box" },
      { tenantId: shopA, name: "Sparklers 15cm", mrp: 20000, discountPct: 75, unit: "packet" },
      { tenantId: shopB, name: "Murugan Rocket", mrp: 50000, discountPct: 70, unit: "box" },
    ])
    .returning({ id: schema.products.id, name: schema.products.name });

  bigBox = inserted[0].id;
  smallBox = inserted[1].id;
  shopBProduct = inserted[2].id;
});

afterAll(async () => {
  await t?.close();
});

const order = (items: { productId: string; quantity: number }[]) => ({
  ...validCustomer,
  items,
});

describe("placeOrder", () => {
  it("creates an order with server-derived prices", async () => {
    const result = await t.asAppRole(() =>
      withTenant(t.db, shopA, (tx) =>
        placeOrder(tx, shopA, order([{ productId: bigBox, quantity: 2 }])),
      ),
    );

    // MRP 1000 at 80% off = Rs 200/box, x2 = Rs 400
    expect(result.subtotal).toBe(40000);
    expect(result.totalSavings).toBe(160000);
    expect(result.itemCount).toBe(2);
    expect(result.estimateNumber).toBe("EST-0001");
  });

  it("ignores any price the client tries to submit", async () => {
    const tampered = {
      ...validCustomer,
      items: [{ productId: bigBox, quantity: 2, mrp: 1, unitPrice: 1, discountPct: 99 }],
    };

    const result = await t.asAppRole(() =>
      withTenant(t.db, shopA, (tx) => placeOrder(tx, shopA, tampered)),
    );

    // Still the real price from the database, not the injected Rs 0.01.
    expect(result.subtotal).toBe(40000);

    const items = await t.db.select().from(schema.orderItems);
    expect(items[0].unitPrice).toBe(20000);
    expect(items[0].discountPct).toBe(80);
  });

  it("snapshots product details so later price changes do not rewrite history", async () => {
    await t.asAppRole(() =>
      withTenant(t.db, shopA, (tx) =>
        placeOrder(tx, shopA, order([{ productId: bigBox, quantity: 2 }])),
      ),
    );

    await t.db
      .update(schema.products)
      .set({ mrp: 999999, discountPct: 10, name: "Renamed" })
      .where(eq(schema.products.id, bigBox));

    const [item] = await t.db.select().from(schema.orderItems);
    expect(item.productName).toBe("Flower Pot Big");
    expect(item.unitPrice).toBe(20000);
    expect(item.mrp).toBe(100000);
  });

  it("rejects an order below the shop's minimum order value", async () => {
    // One packet of sparklers = Rs 50, well under the Rs 2500 minimum.
    await expect(
      t.asAppRole(() =>
        withTenant(t.db, shopA, (tx) =>
          placeOrder(tx, shopA, order([{ productId: smallBox, quantity: 1 }])),
        ),
      ),
    ).rejects.toMatchObject({ code: "BELOW_MINIMUM" });
  });

  it("applies each shop's own minimum independently", async () => {
    // Rs 150 order at shop B, whose minimum is Rs 1000 -- still too low.
    await expect(
      t.asAppRole(() =>
        withTenant(t.db, shopB, (tx) =>
          placeOrder(tx, shopB, order([{ productId: shopBProduct, quantity: 1 }])),
        ),
      ),
    ).rejects.toMatchObject({ code: "BELOW_MINIMUM" });

    // Rs 1500 clears it.
    const ok = await t.asAppRole(() =>
      withTenant(t.db, shopB, (tx) =>
        placeOrder(tx, shopB, order([{ productId: shopBProduct, quantity: 10 }])),
      ),
    );
    expect(ok.subtotal).toBe(150000);
  });

  it("refuses to buy another shop's product from this storefront", async () => {
    // shopBProduct is invisible under shop A's RLS context, so it reads as
    // an unknown product rather than a cross-tenant purchase.
    await expect(
      t.asAppRole(() =>
        withTenant(t.db, shopA, (tx) =>
          placeOrder(tx, shopA, order([{ productId: shopBProduct, quantity: 50 }])),
        ),
      ),
    ).rejects.toMatchObject({ code: "UNKNOWN_PRODUCT" });
  });

  it("merges duplicate lines for the same product", async () => {
    const result = await t.asAppRole(() =>
      withTenant(t.db, shopA, (tx) =>
        placeOrder(
          tx,
          shopA,
          order([
            { productId: bigBox, quantity: 1 },
            { productId: bigBox, quantity: 2 },
          ]),
        ),
      ),
    );

    const items = await t.db.select().from(schema.orderItems);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
    expect(result.subtotal).toBe(60000);
  });

  it("drops zero-quantity rows posted by the bulk order table", async () => {
    const result = await t.asAppRole(() =>
      withTenant(t.db, shopA, (tx) =>
        placeOrder(
          tx,
          shopA,
          order([
            { productId: bigBox, quantity: 2 },
            { productId: smallBox, quantity: 0 },
          ]),
        ),
      ),
    );
    const items = await t.db.select().from(schema.orderItems);
    expect(items).toHaveLength(1);
    expect(result.subtotal).toBe(40000);
  });

  it("rejects an entirely empty submission", async () => {
    await expect(
      t.asAppRole(() =>
        withTenant(t.db, shopA, (tx) =>
          placeOrder(tx, shopA, order([{ productId: bigBox, quantity: 0 }])),
        ),
      ),
    ).rejects.toMatchObject({ code: "EMPTY_CART" });
  });

  it("refuses an inactive product", async () => {
    await t.db
      .update(schema.products)
      .set({ isActive: false })
      .where(eq(schema.products.id, bigBox));

    await expect(
      t.asAppRole(() =>
        withTenant(t.db, shopA, (tx) =>
          placeOrder(tx, shopA, order([{ productId: bigBox, quantity: 5 }])),
        ),
      ),
    ).rejects.toMatchObject({ code: "INACTIVE_PRODUCT" });
  });

  it("enforces stock when the shop tracks it, and ignores it when NULL", async () => {
    await t.db
      .update(schema.products)
      .set({ stock: 3 })
      .where(eq(schema.products.id, bigBox));

    await expect(
      t.asAppRole(() =>
        withTenant(t.db, shopA, (tx) =>
          placeOrder(tx, shopA, order([{ productId: bigBox, quantity: 4 }])),
        ),
      ),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

    await t.asAppRole(() =>
      withTenant(t.db, shopA, (tx) =>
        placeOrder(tx, shopA, order([{ productId: bigBox, quantity: 3 }])),
      ),
    );

    const [p] = await t.db.select().from(schema.products).where(eq(schema.products.id, bigBox));
    expect(p.stock).toBe(0);
  });

  describe("validation", () => {
    const cases: [string, Record<string, unknown>][] = [
      ["a short name", { customerName: "R" }],
      ["a malformed phone number", { customerPhone: "12345" }],
      ["a landline-style number", { customerPhone: "0442345678" }],
      ["a bad PIN code", { pincode: "0625001" }],
      ["a five-digit PIN code", { pincode: "62500" }],
      ["a missing address", { addressLine: "" }],
    ];

    for (const [label, override] of cases) {
      it(`rejects ${label}`, async () => {
        await expect(
          t.asAppRole(() =>
            withTenant(t.db, shopA, (tx) =>
              placeOrder(tx, shopA, {
                ...order([{ productId: bigBox, quantity: 2 }]),
                ...override,
              }),
            ),
          ),
        ).rejects.toMatchObject({ code: "VALIDATION" });
      });
    }

    it("accepts a +91 prefixed mobile number", async () => {
      const result = await t.asAppRole(() =>
        withTenant(t.db, shopA, (tx) =>
          placeOrder(tx, shopA, {
            ...order([{ productId: bigBox, quantity: 2 }]),
            customerPhone: "+91 9842012345",
          }),
        ),
      );
      expect(result.orderNumber).toBe(1);
    });
  });
});

describe("estimate numbering", () => {
  it("numbers sequentially within a shop", async () => {
    const first = await t.asAppRole(() =>
      withTenant(t.db, shopA, (tx) =>
        placeOrder(tx, shopA, order([{ productId: bigBox, quantity: 2 }])),
      ),
    );
    const second = await t.asAppRole(() =>
      withTenant(t.db, shopA, (tx) =>
        placeOrder(tx, shopA, order([{ productId: bigBox, quantity: 3 }])),
      ),
    );
    expect(first.orderNumber).toBe(1);
    expect(second.orderNumber).toBe(2);
    expect(second.estimateNumber).toBe("EST-0002");
  });

  it("numbers each shop from 1 independently", async () => {
    await t.asAppRole(() =>
      withTenant(t.db, shopA, (tx) =>
        placeOrder(tx, shopA, order([{ productId: bigBox, quantity: 2 }])),
      ),
    );
    const bFirst = await t.asAppRole(() =>
      withTenant(t.db, shopB, (tx) =>
        placeOrder(tx, shopB, order([{ productId: shopBProduct, quantity: 10 }])),
      ),
    );
    // Shop B's first estimate must be EST-0001, not EST-0002. Customers
    // notice, and a shop's estimate numbers leaking a rival's order volume
    // is exactly the kind of thing that loses you a client.
    expect(bFirst.orderNumber).toBe(1);
  });

  it("formats estimate numbers with padding", () => {
    expect(formatEstimateNumber(1)).toBe("EST-0001");
    expect(formatEstimateNumber(42)).toBe("EST-0042");
    expect(formatEstimateNumber(12345)).toBe("EST-12345");
  });
});

describe("markOrderPaid", () => {
  it("records the payment reference and timestamp", async () => {
    const placed = await t.asAppRole(() =>
      withTenant(t.db, shopA, (tx) =>
        placeOrder(tx, shopA, order([{ productId: bigBox, quantity: 2 }])),
      ),
    );

    await t.asAppRole(() =>
      withTenant(t.db, shopA, (tx) => markOrderPaid(tx, placed.orderId, "UPI-4457821")),
    );

    const [o] = await t.db.select().from(schema.orders);
    expect(o.status).toBe("paid");
    expect(o.paymentRef).toBe("UPI-4457821");
    expect(o.paidAt).toBeInstanceOf(Date);
  });

  it("requires a reference number", async () => {
    const placed = await t.asAppRole(() =>
      withTenant(t.db, shopA, (tx) =>
        placeOrder(tx, shopA, order([{ productId: bigBox, quantity: 2 }])),
      ),
    );

    await expect(
      t.asAppRole(() =>
        withTenant(t.db, shopA, (tx) => markOrderPaid(tx, placed.orderId, "  ")),
      ),
    ).rejects.toThrow(OrderError);
  });

  it("cannot mark another shop's order paid", async () => {
    const placed = await t.asAppRole(() =>
      withTenant(t.db, shopA, (tx) =>
        placeOrder(tx, shopA, order([{ productId: bigBox, quantity: 2 }])),
      ),
    );

    await t.asAppRole(() =>
      withTenant(t.db, shopB, (tx) => markOrderPaid(tx, placed.orderId, "UPI-HACK")),
    );

    const [o] = await t.db.select().from(schema.orders);
    expect(o.status).toBe("pending");
    expect(o.paymentRef).toBeNull();
  });
});
