import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { schema } from "../../src/db/schema";

const ROOT = join(import.meta.dirname, "..", "..");

/**
 * Spins up a real Postgres (PGlite is Postgres compiled to WASM) with the
 * production schema and the production RLS policies applied.
 *
 * Testing tenant isolation against a mock would prove nothing: the isolation
 * IS the Postgres policy. This runs the same rls.sql that ships to the VPS.
 */
export async function createTestDb() {
  const client = new PGlite();
  await client.waitReady;

  // Apply generated migrations in order.
  const migrationsDir = join(ROOT, "drizzle");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const content = readFileSync(join(migrationsDir, file), "utf8");
    for (const statement of content.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }

  // Apply the real row-level-security policies.
  await client.exec(readFileSync(join(ROOT, "src", "db", "rls.sql"), "utf8"));

  const db = drizzle(client, { schema });

  return {
    client,
    db,
    /**
     * PGlite connects as a superuser, and superusers bypass RLS outright --
     * policies would appear to do nothing. Switching to the unprivileged
     * application role is what makes these tests real.
     */
    async asAppRole<T>(fn: () => Promise<T>): Promise<T> {
      await client.exec("SET ROLE crackers_app");
      try {
        return await fn();
      } finally {
        await client.exec("RESET ROLE");
      }
    },
    async close() {
      await client.close();
    },
  };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

/** Seeds a tenant as superuser (bypassing RLS), returning its id. */
export async function seedTenant(
  t: TestDb,
  overrides: Partial<{
    slug: string;
    shopName: string;
    customDomain: string | null;
    status: string;
    minOrderValue: number;
  }> = {},
): Promise<string> {
  const slug = overrides.slug ?? `shop-${Math.random().toString(36).slice(2, 8)}`;
  const [row] = await t.db
    .insert(schema.tenants)
    .values({
      slug,
      shopName: overrides.shopName ?? `${slug} Crackers`,
      customDomain: overrides.customDomain ?? null,
      status: (overrides.status as any) ?? "active",
      minOrderValue: overrides.minOrderValue ?? 250000,
    })
    .returning({ id: schema.tenants.id });
  return row.id;
}

export { sql, schema };
