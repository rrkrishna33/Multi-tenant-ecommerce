import { describe, it, expect } from "vitest";
import {
  normalizeHost,
  parsePlatformSubdomain,
  resolveTenantForHost,
  isServable,
  TtlCache,
  type ResolvedTenant,
  type TenantLookup,
} from "../src/lib/tenant";

const PLATFORM = "crackerskart.com";

const anil: ResolvedTenant = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "anil-crackers",
  shopName: "Anil Crackers",
  status: "active",
  customDomain: "anilcrackers.com",
};

const lapsed: ResolvedTenant = {
  id: "22222222-2222-2222-2222-222222222222",
  slug: "old-shop",
  shopName: "Old Shop",
  status: "suspended",
  customDomain: null,
};

function makeLookup(tenants: ResolvedTenant[]): TenantLookup & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async byCustomDomain(domain) {
      calls.push(`domain:${domain}`);
      return tenants.find((t) => t.customDomain === domain) ?? null;
    },
    async bySlug(slug) {
      calls.push(`slug:${slug}`);
      return tenants.find((t) => t.slug === slug) ?? null;
    },
  };
}

describe("normalizeHost", () => {
  it("strips port, case, whitespace and the trailing FQDN dot", () => {
    expect(normalizeHost("  AnilCrackers.COM:3000 ")).toBe("anilcrackers.com");
    expect(normalizeHost("anilcrackers.com.")).toBe("anilcrackers.com");
  });
});

describe("parsePlatformSubdomain", () => {
  it("extracts a tenant slug from a platform subdomain", () => {
    expect(parsePlatformSubdomain("anil-crackers.crackerskart.com", PLATFORM)).toBe(
      "anil-crackers",
    );
  });

  it("treats the apex and www as the platform site, not a tenant", () => {
    expect(parsePlatformSubdomain("crackerskart.com", PLATFORM)).toBeNull();
    expect(parsePlatformSubdomain("www.crackerskart.com", PLATFORM)).toBeNull();
  });

  it("returns null for an unrelated domain", () => {
    expect(parsePlatformSubdomain("anilcrackers.com", PLATFORM)).toBeNull();
  });

  it("refuses reserved subdomains that belong to infrastructure", () => {
    expect(parsePlatformSubdomain("admin.crackerskart.com", PLATFORM)).toBeNull();
    expect(parsePlatformSubdomain("api.crackerskart.com", PLATFORM)).toBeNull();
    expect(parsePlatformSubdomain("cdn.crackerskart.com", PLATFORM)).toBeNull();
  });

  it("refuses nested subdomains rather than guessing which label is the tenant", () => {
    expect(parsePlatformSubdomain("a.b.crackerskart.com", PLATFORM)).toBeNull();
  });

  it("does not match a lookalike domain that merely ends with the platform name", () => {
    // evilcrackerskart.com must never resolve as a subdomain of crackerskart.com
    expect(parsePlatformSubdomain("shop.evilcrackerskart.com", PLATFORM)).toBeNull();
    expect(parsePlatformSubdomain("notcrackerskart.com", PLATFORM)).toBeNull();
  });

  it("rejects labels that are not valid DNS labels", () => {
    expect(parsePlatformSubdomain("-bad.crackerskart.com", PLATFORM)).toBeNull();
    expect(parsePlatformSubdomain("bad-.crackerskart.com", PLATFORM)).toBeNull();
  });
});

describe("resolveTenantForHost", () => {
  it("resolves a platform subdomain via slug", async () => {
    const lookup = makeLookup([anil]);
    const t = await resolveTenantForHost("anil-crackers.crackerskart.com", PLATFORM, lookup);
    expect(t?.id).toBe(anil.id);
    expect(lookup.calls).toEqual(["slug:anil-crackers"]);
  });

  it("resolves a custom domain", async () => {
    const lookup = makeLookup([anil]);
    const t = await resolveTenantForHost("anilcrackers.com", PLATFORM, lookup);
    expect(t?.id).toBe(anil.id);
  });

  it("resolves www when only the apex is registered", async () => {
    const lookup = makeLookup([anil]);
    const t = await resolveTenantForHost("www.anilcrackers.com", PLATFORM, lookup);
    expect(t?.id).toBe(anil.id);
    expect(lookup.calls).toEqual(["domain:www.anilcrackers.com", "domain:anilcrackers.com"]);
  });

  it("resolves the apex when only www is registered", async () => {
    const wwwOnly = { ...anil, customDomain: "www.anilcrackers.com" };
    const lookup = makeLookup([wwwOnly]);
    const t = await resolveTenantForHost("anilcrackers.com", PLATFORM, lookup);
    expect(t?.id).toBe(anil.id);
  });

  it("ignores the port a reverse proxy may append", async () => {
    const lookup = makeLookup([anil]);
    expect(await resolveTenantForHost("anilcrackers.com:443", PLATFORM, lookup)).not.toBeNull();
  });

  it("returns null for an unknown domain", async () => {
    const lookup = makeLookup([anil]);
    expect(await resolveTenantForHost("somebodyelse.com", PLATFORM, lookup)).toBeNull();
  });

  it("returns null for an empty host", async () => {
    const lookup = makeLookup([anil]);
    expect(await resolveTenantForHost("", PLATFORM, lookup)).toBeNull();
  });
});

describe("isServable", () => {
  it("serves trial and active shops", () => {
    expect(isServable(anil)).toBe(true);
    expect(isServable({ ...anil, status: "trial" })).toBe(true);
  });

  it("stops serving a suspended shop", () => {
    expect(isServable(lapsed)).toBe(false);
    expect(isServable({ ...anil, status: "past_due" })).toBe(false);
  });
});

describe("TtlCache", () => {
  it("returns a cached value before expiry and drops it after", () => {
    let now = 1000;
    const cache = new TtlCache<string>(60_000, 10, () => now);
    cache.set("a", "hit");
    expect(cache.get("a")).toBe("hit");

    now += 59_000;
    expect(cache.get("a")).toBe("hit");

    now += 2_000;
    expect(cache.get("a")).toBeUndefined();
  });

  it("evicts to stay within maxEntries", () => {
    const cache = new TtlCache<number>(60_000, 3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4);
    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("d")).toBe(4);
  });

  it("supports explicit invalidation when a domain changes", () => {
    const cache = new TtlCache<string>();
    cache.set("anilcrackers.com", "tenant-1");
    cache.delete("anilcrackers.com");
    expect(cache.get("anilcrackers.com")).toBeUndefined();
  });
});
