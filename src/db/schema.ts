import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * All monetary values are stored as INTEGER PAISE (1 rupee = 100 paise).
 * Never use floats for money: an estimate that is off by a rupee because of
 * binary rounding becomes a support call during the Diwali rush.
 */

export const tenantStatus = pgEnum("tenant_status", [
  "trial",
  "active",
  "past_due",
  "suspended",
]);

export const orderStatus = pgEnum("order_status", [
  "pending", // estimate generated, awaiting payment
  "paid", // shop confirmed payment received
  "packed",
  "dispatched",
  "delivered",
  "cancelled",
]);

export const userRole = pgEnum("user_role", [
  "platform_admin", // us, the software provider
  "shop_owner",
  "shop_staff",
]);

/**
 * The tenant registry. This is the one table NOT protected by RLS, because
 * host-based routing must resolve a domain to a tenant before any tenant
 * context exists. It holds no customer data.
 */
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    shopName: text("shop_name").notNull(),
    customDomain: text("custom_domain"),
    status: tenantStatus("status").notNull().default("trial"),

    // Shop contact / legal details printed on estimates
    phone: text("phone"),
    whatsapp: text("whatsapp"),
    email: text("email"),
    addressLine: text("address_line"),
    city: text("city").default("Sivakasi"),
    state: text("state").default("Tamil Nadu"),
    pincode: text("pincode"),
    gstin: text("gstin"),
    licenseNumber: text("license_number"), // explosives licence number

    // Payment collection details printed on the estimate
    upiId: text("upi_id"),
    bankAccountName: text("bank_account_name"),
    bankAccountNumber: text("bank_account_number"),
    bankIfsc: text("bank_ifsc"),

    // Minimum order value in paise. Crackers shops universally enforce one
    // because licensed road transport makes small orders uneconomic.
    minOrderValue: integer("min_order_value").notNull().default(250000),

    themeConfig: jsonb("theme_config")
      .$type<{
        primaryColor?: string;
        accentColor?: string;
        logoUrl?: string;
        bannerUrl?: string;
        tagline?: string;
        // Owner-written notice shown at the top of every storefront page.
        // Kept in theme_config rather than its own column because it is
        // presentation, changes weekly through the season, and needs no
        // migration to add a tone or a toggle later.
        announcement?: string;
        announcementTone?: "info" | "offer" | "urgent";
        announcementDisplay?: "popup" | "banner";
        announcementOn?: boolean;
        // The "About us" block under the price list: who the shop is, what
        // they promise, and where they are.
        about?: {
          headline?: string;
          intro?: string;
          mission?: string;
          vision?: string;
          imageUrl?: string;
        };
      }>()
      .notNull()
      .default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tenants_slug_key").on(t.slug),
    uniqueIndex("tenants_custom_domain_key").on(t.customDomain),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plan: text("plan").notNull(),
    amount: integer("amount").notNull(), // paise per period
    periodMonths: integer("period_months").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("subscriptions_tenant_idx").on(t.tenantId)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULL tenant_id means a platform admin, who belongs to no single shop.
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    role: userRole("role").notNull().default("shop_staff"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_key").on(t.email), index("users_tenant_idx").on(t.tenantId)],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameTa: text("name_ta"), // Tamil name -- most buyers here are Tamil-first
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [index("categories_tenant_idx").on(t.tenantId, t.sortOrder)],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),

    name: text("name").notNull(),
    nameTa: text("name_ta"),
    sku: text("sku"),
    description: text("description"),

    // Crackers sell on an MRP-minus-discount framing ("80% OFF"), so the shop
    // controls mrp + discountPct and the sale price is DERIVED from them.
    // Storing a separate price column would let the two silently drift apart.
    mrp: integer("mrp").notNull(), // paise
    discountPct: integer("discount_pct").notNull().default(0), // 0..100

    // Sold by the box/packet, not by the piece.
    unit: text("unit").notNull().default("box"),
    piecesPerUnit: integer("pieces_per_unit"),

    imageUrl: text("image_url"),
    youtubeUrl: text("youtube_url"), // demo videos drive conversion in this category

    stock: integer("stock"), // NULL = untracked
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("products_tenant_idx").on(t.tenantId, t.sortOrder),
    index("products_category_idx").on(t.categoryId),
    uniqueIndex("products_tenant_sku_key").on(t.tenantId, t.sku),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    // Per-tenant sequential number for the estimate document (EST-0001).
    orderNumber: integer("order_number").notNull(),

    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull(),
    customerEmail: text("customer_email"),
    addressLine: text("address_line").notNull(),
    city: text("city").notNull(),
    state: text("state").notNull(),
    pincode: text("pincode").notNull(),
    notes: text("notes"),

    subtotal: integer("subtotal").notNull(), // paise, sum of line totals
    status: orderStatus("status").notNull().default("pending"),

    // Fireworks move by licensed road transport, never courier or air.
    transportName: text("transport_name"),
    transportLrNumber: text("transport_lr_number"),

    paymentRef: text("payment_ref"), // UPI txn id / bank reference
    paidAt: timestamp("paid_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_tenant_number_key").on(t.tenantId, t.orderNumber),
    index("orders_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),

    // Snapshot of the product at purchase time. Prices move constantly in the
    // run-up to Diwali; an old estimate must still reprint identically.
    productName: text("product_name").notNull(),
    unit: text("unit").notNull(),
    mrp: integer("mrp").notNull(),
    discountPct: integer("discount_pct").notNull(),
    unitPrice: integer("unit_price").notNull(), // paise, after discount
    quantity: integer("quantity").notNull(),
    lineTotal: integer("line_total").notNull(), // unitPrice * quantity
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  products: many(products),
  categories: many(categories),
  orders: many(orders),
  subscriptions: many(subscriptions),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  tenant: one(tenants, { fields: [orders.tenantId], references: [tenants.id] }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));

export const productsRelations = relations(products, ({ one }) => ({
  tenant: one(tenants, { fields: [products.tenantId], references: [tenants.id] }),
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
}));

export const schema = {
  tenants,
  subscriptions,
  users,
  categories,
  products,
  orders,
  orderItems,
};
