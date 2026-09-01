/**
 * Host -> tenant resolution.
 *
 * Two ways a storefront is reached:
 *   1. Platform subdomain   sivakasi-crackers.yourplatform.com  (works immediately)
 *   2. Custom domain        sivakasicrackers.com                (client's own domain)
 *
 * Clients only ever buy a domain and point an A record at the VPS, so (2) must
 * work with no per-tenant configuration on our side beyond a database row.
 */

export type ResolvedTenant = {
  id: string;
  slug: string;
  shopName: string;
  status: "trial" | "active" | "past_due" | "suspended";
  customDomain: string | null;
};

export type TenantLookup = {
  byCustomDomain(domain: string): Promise<ResolvedTenant | null>;
  bySlug(slug: string): Promise<ResolvedTenant | null>;
};

/** Lower-cases, strips the port, the trailing FQDN dot, and any IDN spacing. */
export function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/:\d+$/, "");
}

/**
 * Returns the subdomain label when `host` sits under `platformDomain`,
 * or null when it does not.
 *
 * The apex and `www` are the platform's own marketing site, not a tenant.
 */
export function parsePlatformSubdomain(host: string, platformDomain: string): string | null {
  const h = normalizeHost(host);
  const base = normalizeHost(platformDomain);

  if (h === base || h === `www.${base}`) return null;
  if (!h.endsWith(`.${base}`)) return null;

  const label = h.slice(0, -(base.length + 1));
  // Only a single level of subdomain is a tenant slug. Anything deeper
  // (a.b.platform.com) is not something we issue, so refuse it rather than
  // guessing -- that guess is how you end up serving a tenant from a host
  // an attacker controls a DNS record for.
  if (label.includes(".")) return null;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return null;
  if (RESERVED_SUBDOMAINS.has(label)) return null;

  return label;
}

export const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "admin",
  "api",
  "platform",
  "mail",
  "smtp",
  "ftp",
  "static",
  "cdn",
  "assets",
  "status",
  "docs",
  "support",
  "billing",
  "dashboard",
]);

/** A tenant whose subscription has lapsed should not keep selling. */
export function isServable(tenant: ResolvedTenant): boolean {
  return tenant.status === "trial" || tenant.status === "active";
}

export async function resolveTenantForHost(
  host: string,
  platformDomain: string,
  lookup: TenantLookup,
): Promise<ResolvedTenant | null> {
  const h = normalizeHost(host);
  if (!h) return null;

  const slug = parsePlatformSubdomain(h, platformDomain);
  if (slug) return lookup.bySlug(slug);

  // Not under the platform domain, so it must be a custom domain.
  const exact = await lookup.byCustomDomain(h);
  if (exact) return exact;

  // Clients routinely point both apex and www at us but register only one of
  // them with us. Treat them as the same site rather than 404-ing half a
  // shop's traffic.
  if (h.startsWith("www.")) {
    return lookup.byCustomDomain(h.slice(4));
  }
  return lookup.byCustomDomain(`www.${h}`);
}

/**
 * Small TTL cache. Every storefront request resolves a host, and at Diwali
 * volumes that is otherwise a database round trip per image and page view.
 * A short TTL keeps domain changes propagating within a minute.
 */
export class TtlCache<T> {
  private store = new Map<string, { value: T; expires: number }>();

  constructor(
    private ttlMs = 60_000,
    private maxEntries = 500,
    private now: () => number = Date.now,
  ) {}

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    if (this.store.size >= this.maxEntries) {
      // Cheap eviction: drop the oldest insertion. Good enough for a few
      // hundred domains and avoids pulling in an LRU dependency.
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    this.store.set(key, { value, expires: this.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
