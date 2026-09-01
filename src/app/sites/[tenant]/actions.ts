"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, withTenant } from "@/db";
import { getTenantByKey } from "@/lib/tenant-db";
import { resolveTenantForHost, isServable, normalizeHost } from "@/lib/tenant";
import { dbLookup } from "@/lib/tenant-db";
import { placeOrder, OrderError } from "@/lib/orders";

export type CheckoutState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
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

  // Redirect outside the try: Next signals redirects by throwing, so catching
  // it here would swallow the navigation and show a spurious error.
  redirect(`/order/${orderId}`);
}
