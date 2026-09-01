import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedTenant, schema, type TestDb } from "./helpers/db";
import { hashPassword } from "../src/lib/auth";

/**
 * Regression test for a bug that only a real database could surface.
 *
 * Sign-in must find a user by email BEFORE it knows which tenant they belong
 * to. The `users` table has RLS forced, so that lookup runs with no tenant
 * context and returns zero rows -- meaning login failed for every user, while
 * every unit test that mocked the database still passed.
 *
 * The fix routes only that lookup through the BYPASSRLS `crackers_platform`
 * role. These tests pin down both halves: the app role genuinely cannot see
 * users without context, and the platform role can.
 */
describe("sign-in lookup under RLS", () => {
  let t: TestDb;
  let shopA: string;
  let shopB: string;

  beforeAll(async () => {
    t = await createTestDb();
    shopA = await seedTenant(t, { slug: "anil" });
    shopB = await seedTenant(t, { slug: "murugan" });

    const hash = await hashPassword("crackers2026");
    await t.db.insert(schema.users).values([
      { tenantId: shopA, email: "owner@anil.test", name: "Anil", role: "shop_owner", passwordHash: hash },
      { tenantId: shopB, email: "owner@murugan.test", name: "Murugan", role: "shop_owner", passwordHash: hash },
      { tenantId: null, email: "admin@platform.test", name: "Platform", role: "platform_admin", passwordHash: hash },
    ]);
  });

  afterAll(async () => {
    await t?.close();
  });

  it("finds no user through the app role without tenant context", async () => {
    // This is the failure mode: the lookup silently returns nothing, so the
    // login handler reports "incorrect email or password" for a valid password.
    await t.asAppRole(async () => {
      const rows = await t.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, "owner@anil.test"));
      expect(rows).toHaveLength(0);
    });
  });

  it("finds the user through the RLS-bypassing platform role", async () => {
    // t.db as superuser stands in for the crackers_platform BYPASSRLS role.
    const rows = await t.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "owner@anil.test"));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Anil");
  });

  it("keeps platform admins invisible to a signed-in shop", async () => {
    await t.asAppRole(async () => {
      const rows = await t.db.select().from(schema.users);
      expect(rows).toHaveLength(0);
    });

    // And even with shop A's context set, shop B's staff stay hidden.
    const { withTenant } = await import("../src/db");
    await t.asAppRole(async () => {
      const rows: any[] = await withTenant(t.db, shopA, (tx) => tx.select().from(schema.users));
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe("owner@anil.test");
    });
  });
});
