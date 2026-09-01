import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, schema, type TestDb } from "./helpers/db";
import { createTenant, listTenants, ProvisioningError } from "../src/lib/platform-service";

const PLATFORM = "crackerskart.com";

let t: TestDb;

const base = {
  ownerName: "Selvam",
  ownerPassword: "crackers2026",
  plan: "standard" as const,
  periodMonths: 12,
};

beforeAll(async () => {
  t = await createTestDb();
});

beforeEach(async () => {
  await t.db.execute(sql`truncate table tenants cascade`);
});

afterAll(async () => {
  await t?.close();
});

const shop = (over: Record<string, unknown> = {}) => ({
  ...base,
  shopName: "Selvam Fireworks",
  slug: "selvam-fireworks",
  ownerEmail: "owner@selvam.test",
  ...over,
});

describe("createTenant", () => {
  it("creates the tenant, owner login and subscription together", async () => {
    const created = await createTenant(shop(), PLATFORM, t.db);

    const tenants = await t.db.select().from(schema.tenants);
    const users = await t.db.select().from(schema.users);
    const subs = await t.db.select().from(schema.subscriptions);

    expect(tenants).toHaveLength(1);
    expect(tenants[0].slug).toBe("selvam-fireworks");
    expect(tenants[0].status).toBe("active");
    expect(users).toHaveLength(1);
    expect(users[0].role).toBe("shop_owner");
    expect(users[0].tenantId).toBe(created.tenantId);
    expect(subs).toHaveLength(1);
    expect(subs[0].plan).toBe("standard");
    expect(subs[0].amount).toBe(999000);
  });

  it("stores the owner password hashed, never in the clear", async () => {
    await createTenant(shop(), PLATFORM, t.db);
    const [user] = await t.db.select().from(schema.users);
    expect(user.passwordHash).not.toContain("crackers2026");
    expect(user.passwordHash.startsWith("scrypt$")).toBe(true);
  });

  it("normalises a pasted custom domain", async () => {
    await createTenant(shop({ customDomain: "https://Selvam-Fireworks.com/" }), PLATFORM, t.db);
    const [tenant] = await t.db.select().from(schema.tenants);
    expect(tenant.customDomain).toBe("selvam-fireworks.com");
  });

  it("rejects a duplicate slug", async () => {
    await createTenant(shop(), PLATFORM, t.db);
    await expect(
      createTenant(shop({ ownerEmail: "other@x.test" }), PLATFORM, t.db),
    ).rejects.toMatchObject({ field: "slug" });
  });

  it("rejects a duplicate custom domain", async () => {
    await createTenant(shop({ customDomain: "selvam.com" }), PLATFORM, t.db);
    await expect(
      createTenant(
        shop({ slug: "other-shop", ownerEmail: "other@x.test", customDomain: "selvam.com" }),
        PLATFORM,
        t.db,
      ),
    ).rejects.toMatchObject({ field: "customDomain" });
  });

  it("rejects a duplicate owner email", async () => {
    await createTenant(shop(), PLATFORM, t.db);
    await expect(
      createTenant(shop({ slug: "other-shop" }), PLATFORM, t.db),
    ).rejects.toMatchObject({ field: "ownerEmail" });
  });

  it("rejects a reserved slug", async () => {
    await expect(createTenant(shop({ slug: "admin" }), PLATFORM, t.db)).rejects.toMatchObject({
      field: "slug",
    });
  });

  it("refuses a custom domain under the platform's own domain", async () => {
    await expect(
      createTenant(shop({ customDomain: "someshop.crackerskart.com" }), PLATFORM, t.db),
    ).rejects.toMatchObject({ field: "customDomain" });
  });

  it("refuses a custom domain on a plan that does not include one", async () => {
    await expect(
      createTenant(shop({ plan: "starter", customDomain: "selvam.com" }), PLATFORM, t.db),
    ).rejects.toBeInstanceOf(ProvisioningError);
  });

  it("leaves nothing behind when creation fails partway", async () => {
    await createTenant(shop(), PLATFORM, t.db);
    // Same email, different slug: the tenant insert succeeds, then the user
    // check fails. Without a transaction this would strand a shop nobody can
    // sign in to -- which looks perfectly healthy on the list page.
    await expect(
      createTenant(shop({ slug: "second-shop" }), PLATFORM, t.db),
    ).rejects.toBeInstanceOf(ProvisioningError);

    const tenants = await t.db.select().from(schema.tenants);
    expect(tenants).toHaveLength(1);
    expect(tenants[0].slug).toBe("selvam-fireworks");
  });
});

describe("listTenants", () => {
  /**
   * Regression test for a silent correlation bug.
   *
   * These stats come from correlated subqueries. Interpolating drizzle column
   * references into a raw `sql` template emits unqualified names, so
   * `where "tenant_id" = "id"` bound BOTH sides to the inner table (each of
   * which has its own `id`). That is valid SQL that is always false: every
   * count came back 0 and every plan null, with no error anywhere.
   */
  it("counts each tenant's own products, orders and revenue", async () => {
    const a = await createTenant(shop(), PLATFORM, t.db);
    const b = await createTenant(
      shop({ slug: "murugan", shopName: "Murugan Fireworks", ownerEmail: "m@x.test" }),
      PLATFORM,
      t.db,
    );

    await t.db.insert(schema.products).values([
      { tenantId: a.tenantId, name: "P1", mrp: 10000, discountPct: 50 },
      { tenantId: a.tenantId, name: "P2", mrp: 20000, discountPct: 50 },
      { tenantId: a.tenantId, name: "P3", mrp: 30000, discountPct: 50 },
      { tenantId: b.tenantId, name: "Q1", mrp: 10000, discountPct: 50 },
    ]);

    const order = (tenantId: string, n: number, subtotal: number, status: any) => ({
      tenantId, orderNumber: n, customerName: "C", customerPhone: "9840000000",
      addressLine: "A", city: "Madurai", state: "Tamil Nadu", pincode: "625001",
      subtotal, status,
    });

    await t.db.insert(schema.orders).values([
      order(a.tenantId, 1, 50000, "paid"),
      order(a.tenantId, 2, 30000, "pending"),
      order(a.tenantId, 3, 99999, "cancelled"),
      order(b.tenantId, 1, 70000, "paid"),
    ]);

    const rows = await listTenants(t.db);
    const selvam = rows.find((r) => r.slug === "selvam-fireworks")!;
    const murugan = rows.find((r) => r.slug === "murugan")!;

    expect(selvam.productCount).toBe(3);
    expect(murugan.productCount).toBe(1);

    expect(selvam.orderCount).toBe(3);
    expect(murugan.orderCount).toBe(1);

    // Cancelled orders are excluded from revenue.
    expect(selvam.revenue).toBe(80000);
    expect(murugan.revenue).toBe(70000);
  });

  it("reports each tenant's current plan and expiry", async () => {
    await createTenant(shop(), PLATFORM, t.db);
    await createTenant(
      shop({ slug: "murugan", ownerEmail: "m@x.test", plan: "premium", periodMonths: 1 }),
      PLATFORM,
      t.db,
    );

    const rows = await listTenants(t.db);
    expect(rows.find((r) => r.slug === "selvam-fireworks")!.plan).toBe("standard");
    expect(rows.find((r) => r.slug === "murugan")!.plan).toBe("premium");
    expect(rows.every((r) => r.expiresAt !== null)).toBe(true);
  });

  it("reports a shop with no data as zeroes rather than nulls", async () => {
    await createTenant(shop(), PLATFORM, t.db);
    const [row] = await listTenants(t.db);
    expect(row.productCount).toBe(0);
    expect(row.orderCount).toBe(0);
    expect(row.revenue).toBe(0);
  });
});
