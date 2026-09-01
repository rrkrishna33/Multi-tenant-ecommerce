import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedTenant, schema, sql, type TestDb } from "./helpers/db";
import { withTenant } from "../src/db";

describe("row-level security tenant isolation", () => {
  let t: TestDb;
  let shopA: string;
  let shopB: string;

  beforeAll(async () => {
    t = await createTestDb();
    shopA = await seedTenant(t, { slug: "anil-crackers", customDomain: "anilcrackers.com" });
    shopB = await seedTenant(t, { slug: "murugan-fireworks", customDomain: "muruganfw.com" });

    // Seeded as superuser, so both shops get data regardless of policy.
    await t.db.insert(schema.products).values([
      { tenantId: shopA, name: "Anil 4in Lakshmi", mrp: 30000, discountPct: 80 },
      { tenantId: shopA, name: "Anil Flower Pot Big", mrp: 50000, discountPct: 75 },
      { tenantId: shopB, name: "Murugan 7cm Electric", mrp: 12000, discountPct: 85 },
    ]);
  });

  afterAll(async () => {
    await t?.close();
  });

  it("shows a tenant only its own products", async () => {
    await t.asAppRole(async () => {
      const rows: any[] = await withTenant(t.db, shopA, (tx) => tx.select().from(schema.products));
      expect(rows).toHaveLength(2);
      expect(rows.every((r: any) => r.tenantId === shopA)).toBe(true);
      expect(rows.map((r: any) => r.name).sort()).toEqual([
        "Anil 4in Lakshmi",
        "Anil Flower Pot Big",
      ]);
    });
  });

  it("does not leak the other tenant even when the query has no WHERE clause", async () => {
    await t.asAppRole(async () => {
      const rows: any[] = await withTenant(t.db, shopB, (tx) => tx.select().from(schema.products));
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Murugan 7cm Electric");
    });
  });

  it("returns nothing when no tenant context is set", async () => {
    await t.asAppRole(async () => {
      const rows = await t.db.select().from(schema.products);
      expect(rows).toHaveLength(0);
    });
  });

  it("refuses an insert stamped with a different tenant id", async () => {
    await t.asAppRole(async () => {
      await expect(
        withTenant(t.db, shopA, (tx) =>
          tx.insert(schema.products).values({
            tenantId: shopB, // attacker-supplied
            name: "Injected product",
            mrp: 100,
            discountPct: 0,
          }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("cannot update another tenant's product even by explicit id", async () => {
    const [target] = await t.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.tenantId, shopB));

    await t.asAppRole(async () => {
      await withTenant(t.db, shopA, (tx) =>
        tx
          .update(schema.products)
          .set({ mrp: 1 })
          .where(eq(schema.products.id, target.id)),
      );
    });

    // Verify as superuser that the row is untouched.
    const [after] = await t.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, target.id));
    expect(after.mrp).toBe(12000);
  });

  it("cannot delete another tenant's product", async () => {
    const before = await t.db.select().from(schema.products);

    await t.asAppRole(async () => {
      await withTenant(t.db, shopA, (tx) => tx.delete(schema.products));
    });

    const after = await t.db.select().from(schema.products);
    // Shop A's two products are gone; shop B's one survives.
    expect(before).toHaveLength(3);
    expect(after).toHaveLength(1);
    expect(after[0].tenantId).toBe(shopB);
  });

  it("clears tenant context when the transaction ends", async () => {
    await t.asAppRole(async () => {
      await withTenant(t.db, shopB, async (tx) => {
        const r: any = await tx.execute(sql`select app_current_tenant() as id`);
        expect((r.rows ?? r)[0].id).toBe(shopB);
      });

      // SET LOCAL is transaction-scoped, so a pooled connection handed to the
      // next request must not still be inside shop B.
      const after: any = await t.db.execute(sql`select app_current_tenant() as id`);
      expect((after.rows ?? after)[0].id).toBeNull();
    });
  });

  it("rejects a non-UUID tenant id before it reaches SQL", async () => {
    await expect(
      withTenant(t.db, "'; drop table products; --", async () => "unreachable"),
    ).rejects.toThrow(/non-UUID tenant id/);
  });
});
