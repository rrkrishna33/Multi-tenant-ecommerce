import { describe, it, expect } from "vitest";
import {
  PLANS,
  priceFor,
  addMonths,
  renewalWindow,
  statusForExpiry,
  daysUntil,
  isPlanId,
  GRACE_PERIOD_DAYS,
} from "../src/lib/subscriptions";
import {
  slugify,
  checkSlug,
  checkCustomDomain,
  createTenantSchema,
} from "../src/lib/provisioning";

const utc = (s: string) => new Date(s + "T00:00:00.000Z");

describe("plans", () => {
  it("prices a year below twelve months", () => {
    for (const plan of Object.values(PLANS)) {
      expect(plan.yearlyPrice).toBeLessThan(plan.monthlyPrice * 12);
    }
  });

  it("computes period price", () => {
    expect(priceFor("standard", 1)).toBe(99900);
    expect(priceFor("standard", 12)).toBe(999000);
  });

  it("recognises valid plan ids", () => {
    expect(isPlanId("premium")).toBe(true);
    expect(isPlanId("enterprise")).toBe(false);
  });

  it("restricts custom domains to paid tiers", () => {
    expect(PLANS.starter.customDomain).toBe(false);
    expect(PLANS.standard.customDomain).toBe(true);
  });
});

describe("addMonths", () => {
  it("adds whole months", () => {
    expect(addMonths(utc("2026-09-01"), 1).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(addMonths(utc("2026-09-01"), 12).toISOString()).toBe("2027-09-01T00:00:00.000Z");
  });

  it("clamps to the end of a shorter month", () => {
    // 31 Jan + 1 month must be 28 Feb, not 3 March.
    expect(addMonths(utc("2026-01-31"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(addMonths(utc("2026-10-31"), 1).toISOString()).toBe("2026-11-30T00:00:00.000Z");
  });

  it("handles a leap year", () => {
    expect(addMonths(utc("2028-01-31"), 1).toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("crosses a year boundary", () => {
    expect(addMonths(utc("2026-12-15"), 1).toISOString()).toBe("2027-01-15T00:00:00.000Z");
  });
});

describe("renewalWindow", () => {
  const now = utc("2026-09-01");

  it("extends from the existing expiry when paying early", () => {
    // Paying on 1 Sep for a subscription running to 20 Sep must end 20 Oct,
    // not 1 Oct -- otherwise early payers lose the days they already bought.
    const w = renewalWindow(utc("2026-09-20"), 1, now);
    expect(w.expiresAt.toISOString()).toBe("2026-10-20T00:00:00.000Z");
  });

  it("starts from today when already lapsed", () => {
    const w = renewalWindow(utc("2026-08-01"), 1, now);
    expect(w.startedAt.toISOString()).toBe(now.toISOString());
    expect(w.expiresAt.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("starts from today for a first subscription", () => {
    const w = renewalWindow(null, 12, now);
    expect(w.expiresAt.toISOString()).toBe("2027-09-01T00:00:00.000Z");
  });
});

describe("statusForExpiry", () => {
  const now = utc("2026-10-20");

  it("is trial with no subscription", () => {
    expect(statusForExpiry(null, now)).toBe("trial");
  });

  it("is active before expiry", () => {
    expect(statusForExpiry(utc("2026-11-01"), now)).toBe("active");
  });

  it("is past_due inside the grace period", () => {
    // Peak Diwali week: a lapsed payment must not take the shop offline.
    expect(statusForExpiry(utc("2026-10-19"), now)).toBe("past_due");
    expect(statusForExpiry(utc("2026-10-13"), now)).toBe("past_due");
  });

  it("is suspended once the grace period ends", () => {
    const justPast = new Date(
      utc("2026-10-20").getTime() - (GRACE_PERIOD_DAYS * 86_400_000 + 1000),
    );
    expect(statusForExpiry(justPast, now)).toBe("suspended");
  });

  it("honours a manual suspension regardless of dates", () => {
    expect(
      statusForExpiry(utc("2027-01-01"), now, { manuallySuspended: true }),
    ).toBe("suspended");
  });
});

describe("daysUntil", () => {
  it("counts forward and backward", () => {
    expect(daysUntil(utc("2026-09-11"), utc("2026-09-01"))).toBe(10);
    expect(daysUntil(utc("2026-08-30"), utc("2026-09-01"))).toBe(-2);
  });
});

describe("slugify and checkSlug", () => {
  it("turns a shop name into a usable slug", () => {
    expect(slugify("Anil Crackers")).toBe("anil-crackers");
    expect(slugify("  Sri Murugan Fireworks & Co.  ")).toBe("sri-murugan-fireworks-co");
    expect(slugify("A.B.C Crackers")).toBe("abc-crackers");
  });

  it("never produces a trailing or leading hyphen", () => {
    expect(slugify("--Test--")).toBe("test");
    expect(slugify("Shop !!!")).toBe("shop");
  });

  it("accepts valid slugs", () => {
    expect(checkSlug("anil-crackers").ok).toBe(true);
    expect(checkSlug("shop123").ok).toBe(true);
  });

  it("rejects malformed slugs", () => {
    for (const bad of ["a", "-leading", "trailing-", "Upper", "has space", "under_score"]) {
      expect(checkSlug(bad).ok).toBe(false);
    }
  });

  it("rejects reserved names that would collide with infrastructure", () => {
    for (const reserved of ["www", "admin", "api", "cdn", "billing"]) {
      const result = checkSlug(reserved);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain("reserved");
    }
  });
});

describe("checkCustomDomain", () => {
  const PLATFORM = "crackerskart.com";

  it("accepts a plain domain", () => {
    const r = checkCustomDomain("anilcrackers.com", PLATFORM);
    expect(r).toEqual({ ok: true, domain: "anilcrackers.com" });
  });

  it("normalises what clients actually paste", () => {
    // Clients paste from a browser bar, not from a DNS panel.
    expect(checkCustomDomain("https://AnilCrackers.com/", PLATFORM)).toEqual({
      ok: true,
      domain: "anilcrackers.com",
    });
    expect(checkCustomDomain("http://www.anilcrackers.com/shop", PLATFORM)).toEqual({
      ok: true,
      domain: "www.anilcrackers.com",
    });
    expect(checkCustomDomain("  anilcrackers.com:443 ", PLATFORM)).toEqual({
      ok: true,
      domain: "anilcrackers.com",
    });
  });

  it("accepts a multi-level domain", () => {
    expect(checkCustomDomain("shop.anilcrackers.co.in", PLATFORM).ok).toBe(true);
  });

  it("rejects input that is not a domain", () => {
    for (const bad of ["", "localhost", "not a domain", "anilcrackers", "-bad.com", "bad-.com"]) {
      expect(checkCustomDomain(bad, PLATFORM).ok).toBe(false);
    }
  });

  it("rejects a numeric TLD", () => {
    expect(checkCustomDomain("192.168.1.1", PLATFORM).ok).toBe(false);
  });

  it("refuses a domain under the platform's own domain", () => {
    // Those are ours to issue; letting a client claim one would let them
    // squat a slug we have not assigned yet.
    const r = checkCustomDomain("someshop.crackerskart.com", PLATFORM);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("assigned automatically");
    expect(checkCustomDomain("crackerskart.com", PLATFORM).ok).toBe(false);
  });
});

describe("createTenantSchema", () => {
  const valid = {
    shopName: "Anil Crackers",
    slug: "anil-crackers",
    ownerName: "Anil",
    ownerEmail: "owner@anilcrackers.com",
    ownerPassword: "crackers2026",
    plan: "standard",
    periodMonths: 12,
  };

  it("accepts a complete submission", () => {
    expect(createTenantSchema.safeParse(valid).success).toBe(true);
  });

  it("coerces the billing period from a form string", () => {
    const parsed = createTenantSchema.safeParse({ ...valid, periodMonths: "12" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.periodMonths).toBe(12);
  });

  it("rejects a bad period, plan, email or short password", () => {
    expect(createTenantSchema.safeParse({ ...valid, periodMonths: 6 }).success).toBe(false);
    expect(createTenantSchema.safeParse({ ...valid, plan: "enterprise" }).success).toBe(false);
    expect(createTenantSchema.safeParse({ ...valid, ownerEmail: "nope" }).success).toBe(false);
    expect(createTenantSchema.safeParse({ ...valid, ownerPassword: "short" }).success).toBe(false);
  });
});
