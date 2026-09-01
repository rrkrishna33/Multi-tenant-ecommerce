import { z } from "zod";

/**
 * Subscription plans.
 *
 * Priced in paise. The tiers exist because a Sivakasi shop's willingness to pay
 * is set by what they sell in three weeks of Diwali, not by hosting cost --
 * so the differentiator is order volume, not CPU.
 */
export type PlanId = "starter" | "standard" | "premium";

export type Plan = {
  id: PlanId;
  name: string;
  monthlyPrice: number; // paise
  yearlyPrice: number; // paise, billed once
  maxProducts: number | null; // null = unlimited
  customDomain: boolean;
};

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: "starter",
    name: "Starter",
    monthlyPrice: 49900, // Rs 499
    yearlyPrice: 499000, // Rs 4,990 -- two months free
    maxProducts: 100,
    customDomain: false,
  },
  standard: {
    id: "standard",
    name: "Standard",
    monthlyPrice: 99900, // Rs 999
    yearlyPrice: 999000,
    maxProducts: 500,
    customDomain: true,
  },
  premium: {
    id: "premium",
    name: "Premium",
    monthlyPrice: 199900, // Rs 1,999
    yearlyPrice: 1999000,
    maxProducts: null,
    customDomain: true,
  },
};

export const planIds = Object.keys(PLANS) as PlanId[];

export function isPlanId(value: string): value is PlanId {
  return value in PLANS;
}

export const subscriptionSchema = z.object({
  plan: z.enum(["starter", "standard", "premium"]),
  periodMonths: z.union([z.literal(1), z.literal(12)]),
});

/**
 * Adds whole months to a date, clamping the day so that adding one month to
 * 31 January lands on 28/29 February rather than rolling into March.
 */
export function addMonths(from: Date, months: number): Date {
  const result = new Date(from.getTime());
  const targetDay = result.getUTCDate();
  result.setUTCMonth(result.getUTCMonth() + months, 1);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(targetDay, lastDay));
  return result;
}

export function priceFor(plan: PlanId, periodMonths: number): number {
  const p = PLANS[plan];
  return periodMonths === 12 ? p.yearlyPrice : p.monthlyPrice * periodMonths;
}

/**
 * Renewal extends from the current expiry, not from today, so a shop that pays
 * early is not silently charged for the unused remainder. If it already lapsed,
 * the new period starts now.
 */
export function renewalWindow(
  currentExpiry: Date | null,
  periodMonths: number,
  now: Date,
): { startedAt: Date; expiresAt: Date } {
  const base = currentExpiry && currentExpiry > now ? currentExpiry : now;
  return { startedAt: base, expiresAt: addMonths(base, periodMonths) };
}

export type TenantStatus = "trial" | "active" | "past_due" | "suspended";

/** Days after expiry before a storefront stops serving. */
export const GRACE_PERIOD_DAYS = 7;

/**
 * Decides a tenant's status from its subscription expiry.
 *
 * The grace period is not generosity, it is risk management: a shop whose card
 * fails on 20 October must not have its storefront go dark in the middle of the
 * only three weeks that matter. Chase the payment, keep the shop selling.
 */
export function statusForExpiry(
  expiresAt: Date | null,
  now: Date,
  opts: { manuallySuspended?: boolean } = {},
): TenantStatus {
  if (opts.manuallySuspended) return "suspended";
  if (!expiresAt) return "trial";

  if (expiresAt > now) return "active";

  const graceEnd = new Date(expiresAt.getTime() + GRACE_PERIOD_DAYS * 86_400_000);
  return now <= graceEnd ? "past_due" : "suspended";
}

export function daysUntil(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}

/** Display name for a stored plan id, tolerating a legacy or unknown value. */
export function planName(plan: string): string {
  return isPlanId(plan) ? PLANS[plan].name : plan;
}
