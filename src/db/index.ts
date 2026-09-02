import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { schema } from "./schema";
import { env } from "../lib/env";

/**
 * Postgres returns BIGINT/NUMERIC as strings by default, which silently turns
 * money arithmetic into string concatenation. We store money as INTEGER so it
 * is unaffected, but parse INT8 defensively for any count(*) results.
 */
pg.types.setTypeParser(20, (v) => Number(v));

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = env("DATABASE_URL");
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new pg.Pool({
      connectionString,
      // A single Hostinger VPS runs Postgres alongside Next.js. Keep the pool
      // small enough that a Diwali traffic spike cannot exhaust max_connections
      // and take the database down for every tenant at once.
      max: 15,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

let platformPool: pg.Pool | undefined;

/**
 * Connection for the few operations that legitimately cross tenants, using the
 * BYPASSRLS `crackers_platform` role.
 *
 * There is exactly one unavoidable case in normal request handling: signing in.
 * Authentication has to find the user by email BEFORE it knows which tenant
 * they belong to, and under RLS with no tenant context set that lookup returns
 * zero rows -- so login would fail for everyone.
 *
 * Everything else must use `getDb()` + `withTenant()`. Reaching for this to
 * avoid setting tenant context is how the isolation guarantees get quietly
 * dismantled. It falls back to DATABASE_URL so development works with one
 * connection string, which means in development it is NOT actually bypassing.
 *
 * That fallback is silent by design in development and loud in production: as
 * `crackers_app` this connection is subject to RLS, so sign-in finds no user
 * and NOBODY CAN LOG IN. The failure looks like bad credentials, not like a
 * missing environment variable, so it says so at startup instead.
 */
export function getPlatformDb() {
  if (!platformPool) {
    const configured = env("PLATFORM_DATABASE_URL");
    const connectionString = configured ?? env("DATABASE_URL");
    if (!connectionString) {
      throw new Error("PLATFORM_DATABASE_URL / DATABASE_URL is not set");
    }
    if (!configured && process.env.NODE_ENV === "production") {
      console.warn(
        "[crackers] PLATFORM_DATABASE_URL is not set, falling back to DATABASE_URL." +
          "\n[crackers] That connection is subject to RLS, so sign-in will fail for every user." +
          "\n[crackers] Set PLATFORM_DATABASE_URL to the crackers_platform (BYPASSRLS) role.",
      );
    }
    platformPool = new pg.Pool({
      connectionString,
      max: 5, // only auth and platform admin use this
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return drizzle(platformPool, { schema });
}

/** Anything drizzle-shaped that can run a transaction. Keeps `withTenant`
 *  usable against both node-postgres in production and PGlite in tests. */
type TxCapable = {
  transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
};

/**
 * Runs `fn` inside a transaction with the tenant context set, so every RLS
 * policy resolves to this tenant.
 *
 * The context MUST be set with `set_config(..., is_local => true)` inside a
 * transaction. A session-level SET would leak the previous request's tenant to
 * the next request that borrows the same pooled connection -- the exact bug
 * that turns a multi-tenant app into a data breach.
 */
export async function withTenant<T>(
  db: TxCapable,
  tenantId: string,
  // Drizzle query builders are thenable but are not `Promise`, so accepting
  // only Promise<T> here makes T fail to infer and every call site widen to
  // `unknown`. PromiseLike<T> | T covers builders, async callbacks and plain
  // values alike.
  fn: (tx: any) => PromiseLike<T> | T,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    throw new Error(`withTenant called with a non-UUID tenant id: ${tenantId}`);
  }
  // Cast through TxCapable so the return type comes from `fn`, not from the
  // concrete driver's own `transaction` overloads (which otherwise widen it
  // to unknown at every call site).
  return (db as TxCapable).transaction(async (tx: any) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return await fn(tx);
  }) as Promise<T>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export { schema };
export * from "./schema";
