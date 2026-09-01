import { eq } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "../db";
import { tenants } from "../db/schema";
import {
  TtlCache,
  normalizeHost,
  type ResolvedTenant,
  type TenantLookup,
} from "./tenant";

/**
 * Domain -> tenant resolution backed by the database, with a short TTL cache.
 *
 * Every storefront request needs this, so at Diwali volumes an uncached lookup
 * is a query per page view per tenant. The TTL is short enough that a domain
 * change goes live within a minute without any cache-busting machinery.
 */
const tenantCache = new TtlCache<ResolvedTenant | null>(60_000, 1000);

const COLUMNS = {
  id: tenants.id,
  slug: tenants.slug,
  shopName: tenants.shopName,
  status: tenants.status,
  customDomain: tenants.customDomain,
};

export const dbLookup: TenantLookup = {
  async byCustomDomain(domain: string) {
    const key = `domain:${domain}`;
    const hit = tenantCache.get(key);
    if (hit !== undefined) return hit;

    const [row] = await getDb()
      .select(COLUMNS)
      .from(tenants)
      .where(eq(tenants.customDomain, domain))
      .limit(1);

    const value = (row as ResolvedTenant | undefined) ?? null;
    tenantCache.set(key, value);
    return value;
  },

  async bySlug(slug: string) {
    const key = `slug:${slug}`;
    const hit = tenantCache.get(key);
    if (hit !== undefined) return hit;

    const [row] = await getDb()
      .select(COLUMNS)
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);

    const value = (row as ResolvedTenant | undefined) ?? null;
    tenantCache.set(key, value);
    return value;
  },
};

/** Call after changing a tenant's domain or status so the change takes effect
 *  immediately rather than after the TTL. */
export function invalidateTenantCache(tenant: {
  slug?: string | null;
  customDomain?: string | null;
}) {
  if (tenant.slug) tenantCache.delete(`slug:${tenant.slug}`);
  if (tenant.customDomain) tenantCache.delete(`domain:${normalizeHost(tenant.customDomain)}`);
}

/**
 * Resolves the tenant for a rewritten `/_sites/[tenantKey]` segment, which is
 * either a platform subdomain slug or a full custom domain.
 *
 * Wrapped in React's `cache` so a page, its layout, and its metadata function
 * share one lookup per request instead of three.
 */
export const getTenantByKey = cache(async (tenantKey: string): Promise<ResolvedTenant | null> => {
  const key = decodeURIComponent(tenantKey);
  if (key.includes(".")) {
    const exact = await dbLookup.byCustomDomain(key);
    if (exact) return exact;
    return key.startsWith("www.")
      ? dbLookup.byCustomDomain(key.slice(4))
      : dbLookup.byCustomDomain(`www.${key}`);
  }
  return dbLookup.bySlug(key);
});

export { tenantCache };
