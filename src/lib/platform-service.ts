import { eq, sql, desc, and, isNull } from "drizzle-orm";
import { getPlatformDb } from "@/db";
import { tenants, users, subscriptions, products, orders } from "@/db/schema";
import { hashPassword } from "./auth";
import {
  checkSlug,
  checkCustomDomain,
  createTenantSchema,
  type CreateTenantInput,
} from "./provisioning";
import {
  PLANS,
  priceFor,
  renewalWindow,
  statusForExpiry,
  type PlanId,
} from "./subscriptions";
import { invalidateTenantCache } from "./tenant-db";

/**
 * Platform-side operations: creating and administering tenants.
 *
 * Everything here uses the BYPASSRLS platform connection by design -- these are
 * the cross-tenant operations. Nothing in this file may be reachable without a
 * verified platform_admin session.
 */

export class ProvisioningError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
  }
}

export type TenantSummary = {
  id: string;
  slug: string;
  shopName: string;
  customDomain: string | null;
  status: string;
  createdAt: Date;
  productCount: number;
  orderCount: number;
  revenue: number;
  plan: string | null;
  expiresAt: Date | null;
};

export async function listTenants(dbOverride?: any): Promise<TenantSummary[]> {
  // The override exists so the correlated-subquery correctness above can be
  // tested against a real database without standing up the platform pool.
  const db = dbOverride ?? getPlatformDb();

  const rows = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      shopName: tenants.shopName,
      customDomain: tenants.customDomain,
      status: tenants.status,
      createdAt: tenants.createdAt,
      // These correlated subqueries are written with literal, table-qualified
      // SQL on purpose. Interpolating drizzle column references here emits
      // UNQUALIFIED names -- `where "tenant_id" = "id"` -- which inside the
      // subquery both resolve to the inner table, since products/orders/
      // subscriptions each have their own `id`. That is valid SQL that is
      // always false, so it returns 0 and null for every tenant with no error
      // at all. Aliasing the inner table and naming `tenants.id` explicitly is
      // what makes the correlation real.
      productCount: sql<number>`(
        select count(*)::int from products p where p.tenant_id = tenants.id
      )`,
      orderCount: sql<number>`(
        select count(*)::int from orders o where o.tenant_id = tenants.id
      )`,
      revenue: sql<number>`(
        select coalesce(sum(o.subtotal), 0)::int from orders o
        where o.tenant_id = tenants.id and o.status <> 'cancelled'
      )`,
      plan: sql<string | null>`(
        select s.plan from subscriptions s
        where s.tenant_id = tenants.id and s.cancelled_at is null
        order by s.expires_at desc limit 1
      )`,
      expiresAt: sql<Date | null>`(
        select s.expires_at from subscriptions s
        where s.tenant_id = tenants.id and s.cancelled_at is null
        order by s.expires_at desc limit 1
      )`,
    })
    .from(tenants)
    .orderBy(desc(tenants.createdAt));

  return rows as TenantSummary[];
}

export async function getTenant(id: string) {
  const [row] = await getPlatformDb().select().from(tenants).where(eq(tenants.id, id));
  return row ?? null;
}

export async function getTenantSubscriptions(tenantId: string) {
  return getPlatformDb()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .orderBy(desc(subscriptions.expiresAt));
}

export async function getTenantUsers(tenantId: string) {
  return getPlatformDb()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.tenantId, tenantId));
}

/**
 * Creates a shop: the tenant row, its first subscription, and the owner login,
 * in one transaction. A half-created tenant -- a shop with no way to sign in,
 * or a login pointing at a tenant that does not exist -- is worse than a
 * failed creation, because it looks fine on the list page.
 */
export async function createTenant(
  raw: unknown,
  platformDomain: string,
  dbOverride?: any,
): Promise<{ tenantId: string; slug: string }> {
  const parsed = createTenantSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ProvisioningError(first.message, String(first.path[0] ?? ""));
  }
  const input: CreateTenantInput = parsed.data;

  const slugCheck = checkSlug(input.slug);
  if (!slugCheck.ok) throw new ProvisioningError(slugCheck.message, "slug");

  let customDomain: string | null = null;
  if (input.customDomain) {
    if (!PLANS[input.plan as PlanId].customDomain) {
      throw new ProvisioningError(
        `The ${PLANS[input.plan as PlanId].name} plan does not include a custom domain.`,
        "customDomain",
      );
    }
    const domainCheck = checkCustomDomain(input.customDomain, platformDomain);
    if (!domainCheck.ok) throw new ProvisioningError(domainCheck.message, "customDomain");
    customDomain = domainCheck.domain;
  }

  const db = dbOverride ?? getPlatformDb();
  const email = input.ownerEmail.trim().toLowerCase();
  const passwordHash = await hashPassword(input.ownerPassword);

  return db.transaction(async (tx: any) => {
    const [slugTaken] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, input.slug));
    if (slugTaken) throw new ProvisioningError("That address is already taken.", "slug");

    if (customDomain) {
      const [domainTaken] = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.customDomain, customDomain));
      if (domainTaken) {
        throw new ProvisioningError("That domain is already in use.", "customDomain");
      }
    }

    const [emailTaken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (emailTaken) throw new ProvisioningError("That email is already registered.", "ownerEmail");

    const [tenant] = await tx
      .insert(tenants)
      .values({
        slug: input.slug,
        shopName: input.shopName,
        customDomain,
        status: "active",
        phone: input.phone || null,
        email,
      })
      .returning({ id: tenants.id, slug: tenants.slug });

    await tx.insert(users).values({
      tenantId: tenant.id,
      email,
      name: input.ownerName,
      role: "shop_owner",
      passwordHash,
    });

    const now = new Date();
    const window = renewalWindow(null, input.periodMonths, now);
    await tx.insert(subscriptions).values({
      tenantId: tenant.id,
      plan: input.plan,
      amount: priceFor(input.plan as PlanId, input.periodMonths),
      periodMonths: input.periodMonths,
      startedAt: window.startedAt,
      expiresAt: window.expiresAt,
    });

    return { tenantId: tenant.id, slug: tenant.slug };
  });
}

export async function updateTenantDomain(
  tenantId: string,
  rawDomain: string,
  platformDomain: string,
): Promise<void> {
  const db = getPlatformDb();
  const [existing] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!existing) throw new ProvisioningError("Shop not found.");

  let domain: string | null = null;
  if (rawDomain.trim() !== "") {
    const check = checkCustomDomain(rawDomain, platformDomain);
    if (!check.ok) throw new ProvisioningError(check.message, "customDomain");
    domain = check.domain;

    const [taken] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.customDomain, domain));
    if (taken && taken.id !== tenantId) {
      throw new ProvisioningError("That domain is already in use.", "customDomain");
    }
  }

  await db
    .update(tenants)
    .set({ customDomain: domain, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  // The old domain must stop resolving immediately, not after the cache TTL.
  invalidateTenantCache({ slug: existing.slug, customDomain: existing.customDomain });
  invalidateTenantCache({ slug: existing.slug, customDomain: domain });
}

export async function setTenantStatus(
  tenantId: string,
  status: "trial" | "active" | "past_due" | "suspended",
): Promise<void> {
  const db = getPlatformDb();
  const [existing] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!existing) throw new ProvisioningError("Shop not found.");

  await db
    .update(tenants)
    .set({ status, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  invalidateTenantCache({ slug: existing.slug, customDomain: existing.customDomain });
}

/** Records a subscription payment and extends the shop's expiry. */
export async function renewSubscription(
  tenantId: string,
  plan: PlanId,
  periodMonths: number,
): Promise<{ expiresAt: Date }> {
  const db = getPlatformDb();

  const [current] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, tenantId), isNull(subscriptions.cancelledAt)))
    .orderBy(desc(subscriptions.expiresAt))
    .limit(1);

  const now = new Date();
  const window = renewalWindow(current?.expiresAt ?? null, periodMonths, now);

  await db.insert(subscriptions).values({
    tenantId,
    plan,
    amount: priceFor(plan, periodMonths),
    periodMonths,
    startedAt: window.startedAt,
    expiresAt: window.expiresAt,
  });

  const [existing] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  await db
    .update(tenants)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  if (existing) {
    invalidateTenantCache({ slug: existing.slug, customDomain: existing.customDomain });
  }

  return { expiresAt: window.expiresAt };
}

/**
 * Recomputes every tenant's status from its subscription expiry. Intended for a
 * daily cron; safe to run repeatedly.
 *
 * Only touches tenants whose status is subscription-derived. A shop suspended
 * by hand stays suspended until a human reverses it.
 */
export async function reconcileTenantStatuses(now = new Date()): Promise<
  { tenantId: string; slug: string; from: string; to: string }[]
> {
  const db = getPlatformDb();
  const rows = await listTenants();
  const changes: { tenantId: string; slug: string; from: string; to: string }[] = [];

  for (const row of rows) {
    if (row.status === "suspended" && !row.expiresAt) continue;
    const next = statusForExpiry(row.expiresAt ? new Date(row.expiresAt) : null, now);
    if (next === row.status) continue;

    await db.update(tenants).set({ status: next, updatedAt: now }).where(eq(tenants.id, row.id));
    invalidateTenantCache({ slug: row.slug, customDomain: row.customDomain });
    changes.push({ tenantId: row.id, slug: row.slug, from: row.status, to: next });
  }

  return changes;
}
