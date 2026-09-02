"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { login, logout, requirePlatformAdmin } from "@/lib/session";
import {
  createTenant,
  updateTenantDomain,
  setTenantStatus,
  renewSubscription,
  ProvisioningError,
} from "@/lib/platform-service";
import { isPlanId } from "@/lib/subscriptions";
import { envOr } from "@/lib/env";

function platformDomain() {
  return envOr("PLATFORM_DOMAIN", "localhost:3000");
}

/** Guards every platform action. Platform admins have no tenant, so the
 *  tenant-scoped guard used by shop admin does not apply here. */
async function guard() {
  const session = await requirePlatformAdmin();
  if (!session) redirect("/platform/login");
  return session;
}

export async function platformLoginAction(_prev: { error?: string }, formData: FormData) {
  const result = await login(
    String(formData.get("email") ?? ""),
    String(formData.get("password") ?? ""),
    null,
  );
  if (!result.ok) return { error: result.error };

  // login() accepts a platform admin regardless of tenant, but a shop owner
  // signing in here would also succeed -- so re-check the role and refuse.
  const session = await requirePlatformAdmin();
  if (!session) {
    await logout();
    return { error: "That account cannot access the platform admin." };
  }
  redirect("/platform");
}

export async function platformLogoutAction() {
  await logout();
  redirect("/platform/login");
}

export type CreateTenantState = { error?: string; field?: string };

export async function createTenantAction(
  _prev: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  await guard();

  let slug: string;
  try {
    const result = await createTenant(
      {
        shopName: String(formData.get("shopName") ?? ""),
        slug: String(formData.get("slug") ?? ""),
        ownerName: String(formData.get("ownerName") ?? ""),
        ownerEmail: String(formData.get("ownerEmail") ?? ""),
        ownerPassword: String(formData.get("ownerPassword") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        customDomain: String(formData.get("customDomain") ?? ""),
        plan: String(formData.get("plan") ?? ""),
        periodMonths: String(formData.get("periodMonths") ?? "1"),
      },
      platformDomain(),
    );
    slug = result.slug;
  } catch (err) {
    if (err instanceof ProvisioningError) return { error: err.message, field: err.field };
    console.error("createTenant failed", err);
    return { error: "Could not create the shop. Please try again." };
  }

  revalidatePath("/platform");
  redirect(`/platform?created=${encodeURIComponent(slug)}`);
}

export async function updateDomainAction(_prev: { error?: string }, formData: FormData) {
  await guard();
  const tenantId = String(formData.get("tenantId") ?? "");
  try {
    await updateTenantDomain(tenantId, String(formData.get("customDomain") ?? ""), platformDomain());
  } catch (err) {
    if (err instanceof ProvisioningError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/platform/${tenantId}`);
  return {};
}

export async function setStatusAction(formData: FormData) {
  await guard();
  const tenantId = String(formData.get("tenantId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!["trial", "active", "past_due", "suspended"].includes(status)) {
    throw new Error("Invalid status");
  }
  await setTenantStatus(tenantId, status as any);
  revalidatePath(`/platform/${tenantId}`);
  revalidatePath("/platform");
}

export async function renewAction(formData: FormData) {
  await guard();
  const tenantId = String(formData.get("tenantId") ?? "");
  const plan = String(formData.get("plan") ?? "");
  const periodMonths = Number(formData.get("periodMonths") ?? 1);
  if (!isPlanId(plan)) throw new Error("Invalid plan");
  if (periodMonths !== 1 && periodMonths !== 12) throw new Error("Invalid period");

  await renewSubscription(tenantId, plan, periodMonths);
  revalidatePath(`/platform/${tenantId}`);
  revalidatePath("/platform");
}
