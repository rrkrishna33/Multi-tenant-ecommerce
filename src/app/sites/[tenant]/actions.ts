"use server";

import { headers } from "next/headers";
import { getDb, withTenant } from "@/db";
import { getTenantByKey } from "@/lib/tenant-db";
import { resolveTenantForHost, isServable, normalizeHost } from "@/lib/tenant";
import { dbLookup } from "@/lib/tenant-db";
import { placeOrder, OrderError } from "@/lib/orders";

export type CheckoutState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /** Set once the order exists; the client then navigates to its estimate. */
  orderId?: string;
};

/**
 * Resolves the shop from the incoming Host header.
 *
 * The tenant is deliberately NOT taken from a form field. A server action is a
 * public HTTP endpoint, so any tenant id posted by the client would be an
 * open invitation to write orders into another shop's books.
 */
async function currentTenant() {
  const h = await headers();
  const host = normalizeHost(h.get("host") ?? "");
  const platformDomain = normalizeHost(process.env.PLATFORM_DOMAIN ?? "localhost:3000");
  const tenant = await resolveTenantForHost(host, platformDomain, dbLookup);
  if (!tenant || !isServable(tenant)) return null;
  return tenant;
}

export async function submitOrder(
  _prev: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const tenant = await currentTenant();
  if (!tenant) return { error: "This store is unavailable. Please try again later." };

  let items: { productId: string; quantity: number }[];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { error: "Your cart could not be read. Please refresh and try again." };
  }

  const payload = {
    customerName: String(formData.get("customerName") ?? ""),
    customerPhone: String(formData.get("customerPhone") ?? ""),
    customerEmail: String(formData.get("customerEmail") ?? ""),
    addressLine: String(formData.get("addressLine") ?? ""),
    city: String(formData.get("city") ?? ""),
    state: String(formData.get("state") ?? "Tamil Nadu"),
    pincode: String(formData.get("pincode") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    items,
  };

  let orderId: string;
  try {
    const result = await withTenant(getDb(), tenant.id, (tx) =>
      placeOrder(tx, tenant.id, payload),
    );
    orderId = result.orderId;
  } catch (err) {
    if (err instanceof OrderError) {
      return {
        error: err.message,
        fieldErrors:
          err.code === "VALIDATION"
            ? (err.details as any)?.fieldErrors
            : undefined,
      };
    }
    console.error("placeOrder failed", err);
    return { error: "Something went wrong placing your order. Please try again." };
  }

  /**
   * Deliberately NOT `redirect()`.
   *
   * Every page here is reached through a middleware host rewrite, and a
   * redirect out of a server action is followed by the client router rather
   * than the browser: it fetches the new URL as a flight request whose router
   * state tree was built for the rewritten path. That combination intermittently
   * rendered "page not found" on the estimate the customer had just created --
   * a page that loads perfectly on refresh, which is exactly what customers
   * reported.
   *
   * Handing the order id back and letting the client do a full navigation makes
   * this hop identical to that refresh. It costs one page load on the single
   * most important transition in the app, and removes the failure entirely.
   * Without JavaScript the customer gets a plain link to the same URL.
   */
  return { orderId };
}
