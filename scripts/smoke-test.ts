import { getDb, withTenant } from "../src/db";
import { tenants, products, orders, orderItems } from "../src/db/schema";
import { placeOrder, markOrderPaid } from "../src/lib/orders";
import { formatInr } from "../src/lib/pricing";
import { eq } from "drizzle-orm";

const db = getDb();

const [shop] = await db.select().from(tenants).where(eq(tenants.slug, "anil-crackers"));
console.log(`shop: ${shop.shopName}  min order ${formatInr(shop.minOrderValue)}`);

const items = await withTenant(db, shop.id, (tx) =>
  tx.select().from(products).limit(8),
);
console.log(`catalogue visible to this tenant: ${items.length} of them sampled`);

// 1. below minimum must be refused
try {
  await withTenant(db, shop.id, (tx) =>
    placeOrder(tx, shop.id, {
      customerName: "Test Buyer", customerPhone: "9842011111",
      addressLine: "1 Test Street", city: "Madurai", state: "Tamil Nadu", pincode: "625001",
      items: [{ productId: items[0].id, quantity: 1 }],
    }),
  );
  console.log("below-minimum order: NOT BLOCKED  <-- bug");
} catch (e: any) {
  console.log(`below-minimum order: blocked (${e.code})`);
}

// 2. a real order
const placed = await withTenant(db, shop.id, (tx) =>
  placeOrder(tx, shop.id, {
    customerName: "Ravi Kumar", customerPhone: "+91 9842012345",
    customerEmail: "ravi@example.com",
    addressLine: "12 Anna Nagar, Main Road", city: "Madurai",
    state: "Tamil Nadu", pincode: "625001", notes: "Deliver before Diwali",
    items: items.map((p: any, i: number) => ({ productId: p.id, quantity: (i + 1) * 4 })),
  }),
);
console.log(`order placed: ${placed.estimateNumber}  ${formatInr(placed.subtotal)}  saved ${formatInr(placed.totalSavings)}  (${placed.itemCount} units)`);

// 3. second order must increment
const second = await withTenant(db, shop.id, (tx) =>
  placeOrder(tx, shop.id, {
    customerName: "Second Buyer", customerPhone: "9842022222",
    addressLine: "9 Second Street", city: "Theni", state: "Tamil Nadu", pincode: "625531",
    items: items.map((p: any) => ({ productId: p.id, quantity: 5 })),
  }),
);
console.log(`second estimate number: ${second.estimateNumber}`);

// 4. mark paid
await withTenant(db, shop.id, (tx) => markOrderPaid(tx, placed.orderId, "UPI-998877665544"));
const [paid] = await withTenant(db, shop.id, (tx) =>
  tx.select().from(orders).where(eq(orders.id, placed.orderId)),
);
console.log(`marked paid: status=${paid.status} ref=${paid.paymentRef}`);

// 5. line snapshot check
const lines = await withTenant(db, shop.id, (tx) =>
  tx.select().from(orderItems).where(eq(orderItems.orderId, placed.orderId)),
);
const sum = lines.reduce((s: number, l: any) => s + l.lineTotal, 0);
console.log(`lines: ${lines.length}, sum ${formatInr(sum)}, matches order subtotal: ${sum === paid.subtotal}`);
console.log(`sample line: ${lines[0].productName} x${lines[0].quantity} @ ${formatInr(lines[0].unitPrice)} (MRP ${formatInr(lines[0].mrp)}, ${lines[0].discountPct}% off)`);
process.exit(0);
