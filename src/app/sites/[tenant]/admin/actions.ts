"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq, sql } from "drizzle-orm";
import { getDb, withTenant } from "@/db";
import { products, categories, orders, tenants } from "@/db/schema";
import { resolveTenantForHost, normalizeHost } from "@/lib/tenant";
import { dbLookup } from "@/lib/tenant-db";
import { login, logout, requireShopAccess } from "@/lib/session";
import { markOrderPaid, OrderError } from "@/lib/orders";
import { parseProductCsv } from "@/lib/csv-import";
import {
  validateImage,
  buildImagePath,
  publicUrlFor,
  uploadRoot,
  relativePathFromUrl,
  MAX_IMAGE_BYTES,
} from "@/lib/uploads";
import { parseProductForm, ProductError } from "@/lib/products";
import { parseShopSettings, SettingsError } from "@/lib/shop-settings";
import { invalidateTenantCache } from "@/lib/tenant-db";
import { PLANS, isPlanId } from "@/lib/subscriptions";
import { getPlatformDb } from "@/db";
import { subscriptions } from "@/db/schema";
import { desc, isNull, and, count } from "drizzle-orm";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { envOr } from "@/lib/env";

async function currentTenantId(): Promise<string | null> {
  const h = await headers();
  const host = normalizeHost(h.get("host") ?? "");
  const platformDomain = normalizeHost(envOr("PLATFORM_DOMAIN", "localhost:3000"));
  const tenant = await resolveTenantForHost(host, platformDomain, dbLookup);
  return tenant?.id ?? null;
}

/** Every admin action funnels through this. One place to get authorisation
 *  right beats a `requireShopAccess` call that one handler forgets. */
async function withAuth<T>(fn: (tenantId: string) => Promise<T>): Promise<T> {
  const tenantId = await currentTenantId();
  if (!tenantId) throw new Error("Unknown shop");
  const session = await requireShopAccess(tenantId);
  if (!session) redirect("/login");
  return fn(tenantId);
}

export type LoginState = { error?: string; to?: string };

/** See platformLoginAction: the client navigates, this does not redirect. */
export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const tenantId = await currentTenantId();
  const result = await login(
    String(formData.get("email") ?? ""),
    String(formData.get("password") ?? ""),
    tenantId,
  );
  if (!result.ok) return { error: result.error };
  return { to: "/admin" };
}

/** The caller navigates; see SignOutButton. */
export async function logoutAction() {
  await logout();
}

export async function markPaidAction(_prev: { error?: string }, formData: FormData) {
  const orderId = String(formData.get("orderId") ?? "");
  const paymentRef = String(formData.get("paymentRef") ?? "");

  try {
    await withAuth((tenantId) =>
      withTenant(getDb(), tenantId, (tx) => markOrderPaid(tx, orderId, paymentRef)),
    );
  } catch (err) {
    if (err instanceof OrderError) return { error: err.message };
    throw err;
  }

  revalidatePath("/admin/orders");
  return {};
}

export async function updateOrderStatusAction(formData: FormData) {
  const orderId = String(formData.get("orderId") ?? "");
  const status = String(formData.get("status") ?? "");
  const transportName = String(formData.get("transportName") ?? "");
  const transportLrNumber = String(formData.get("transportLrNumber") ?? "");

  const allowed = ["pending", "paid", "packed", "dispatched", "delivered", "cancelled"];
  if (!allowed.includes(status)) throw new Error("Invalid status");

  await withAuth((tenantId) =>
    withTenant(getDb(), tenantId, (tx) =>
      tx
        .update(orders)
        .set({
          status: status as any,
          transportName: transportName || null,
          transportLrNumber: transportLrNumber || null,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId)),
    ),
  );

  revalidatePath("/admin/orders");
}

export type ImportState = {
  error?: string;
  imported?: number;
  issues?: { line: number; message: string }[];
};

/**
 * Bulk product import. Every shop arrives with an Excel price list, so this is
 * the first thing they do and the fastest path to a live storefront.
 */
export async function importProductsAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file to upload." };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { error: "That file is larger than 5 MB. Please split it." };
  }

  const { rows, issues } = parseProductCsv(await file.text());
  if (rows.length === 0) {
    return { error: issues[0]?.message ?? "No products found in that file.", issues };
  }

  const replace = formData.get("replace") === "on";

  const imported = await withAuth((tenantId) =>
    withTenant(getDb(), tenantId, async (tx) => {
      if (replace) {
        // Deactivate rather than delete: existing orders reference these rows,
        // and a shop that re-imports mid-season must not lose its order history.
        await tx.update(products).set({ isActive: false });
      }

      // Resolve category names to ids, creating any that are new.
      const existing = await tx.select().from(categories);
      const byName = new Map(existing.map((c: any) => [c.name.toLowerCase(), c.id]));

      const needed = [
        ...new Set(rows.map((r) => r.categoryName).filter((c): c is string => !!c)),
      ];
      let sort = existing.length;
      for (const name of needed) {
        if (byName.has(name.toLowerCase())) continue;
        const [created] = await tx
          .insert(categories)
          .values({ tenantId, name, sortOrder: sort++ })
          .returning({ id: categories.id });
        byName.set(name.toLowerCase(), created.id);
      }

      let count = 0;
      for (const [index, row] of rows.entries()) {
        const values = {
          tenantId,
          categoryId: row.categoryName ? byName.get(row.categoryName.toLowerCase())! : null,
          name: row.name,
          sku: row.sku,
          mrp: row.mrp,
          discountPct: row.discountPct,
          unit: row.unit,
          piecesPerUnit: row.piecesPerUnit,
          youtubeUrl: row.youtubeUrl,
          sortOrder: index,
          isActive: true,
          updatedAt: new Date(),
        };

        if (row.sku) {
          // Re-importing an updated price list is the normal case, so a known
          // SKU updates in place instead of creating a duplicate product.
          await tx
            .insert(products)
            .values(values)
            .onConflictDoUpdate({
              target: [products.tenantId, products.sku],
              set: {
                name: values.name,
                categoryId: values.categoryId,
                mrp: values.mrp,
                discountPct: values.discountPct,
                unit: values.unit,
                piecesPerUnit: values.piecesPerUnit,
                youtubeUrl: values.youtubeUrl,
                sortOrder: values.sortOrder,
                isActive: true,
                updatedAt: new Date(),
              },
            });
        } else {
          await tx.insert(products).values(values);
        }
        count++;
      }
      return count;
    }),
  );

  revalidatePath("/admin/products");
  revalidatePath("/");
  return { imported, issues };
}

export async function toggleProductAction(formData: FormData) {
  const id = String(formData.get("productId") ?? "");
  await withAuth((tenantId) =>
    withTenant(getDb(), tenantId, (tx) =>
      tx
        .update(products)
        .set({ isActive: sql`not ${products.isActive}`, updatedAt: new Date() })
        .where(eq(products.id, id)),
    ),
  );
  revalidatePath("/admin/products");
  revalidatePath("/");
}


export type ImageState = { error?: string; ok?: boolean };

/**
 * Attaches a photo to a product.
 *
 * The file is validated by its magic bytes, not its name or the Content-Type
 * the browser claims, and is written under a per-tenant directory with a
 * generated filename. Nothing the client sends reaches the filesystem path.
 */
export async function uploadProductImageAction(
  _prev: ImageState,
  formData: FormData,
): Promise<ImageState> {
  const productId = String(formData.get("productId") ?? "");
  const file = formData.get("image");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a photo to upload." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: `Images must be under ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))} MB.` };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateImage(bytes, file.size);
  if (!check.ok) return { error: check.message };

  try {
    await withAuth(async (tenantId) => {
      const relative = buildImagePath(tenantId, check.extension);
      const absolute = join(uploadRoot(), relative);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, bytes);

      await withTenant(getDb(), tenantId, async (tx) => {
        // RLS scopes this update, so a product id belonging to another shop
        // simply matches nothing.
        const existing = await tx
          .select({ imageUrl: products.imageUrl })
          .from(products)
          .where(eq(products.id, productId));

        if (existing.length === 0) {
          throw new Error("NO_SUCH_PRODUCT");
        }

        await tx
          .update(products)
          .set({ imageUrl: publicUrlFor(relative), updatedAt: new Date() })
          .where(eq(products.id, productId));

        // Remove the file the product was using before, so replacing a photo
        // repeatedly through the season does not fill the VPS disk.
        await removeStoredFile(existing[0].imageUrl);
      });
    });
  } catch (err: any) {
    if (err?.message === "NO_SUCH_PRODUCT") {
      return { error: "That product no longer exists." };
    }
    console.error("uploadProductImage failed", err);
    return { error: "Could not save that photo. Please try again." };
  }

  revalidatePath("/admin/products");
  revalidatePath("/");
  return { ok: true };
}

export async function removeProductImageAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "");

  await withAuth((tenantId) =>
    withTenant(getDb(), tenantId, async (tx) => {
      const [existing] = await tx
        .select({ imageUrl: products.imageUrl })
        .from(products)
        .where(eq(products.id, productId));
      if (!existing) return;

      await tx
        .update(products)
        .set({ imageUrl: null, updatedAt: new Date() })
        .where(eq(products.id, productId));

      await removeStoredFile(existing.imageUrl);
    }),
  );

  revalidatePath("/admin/products");
  revalidatePath("/");
}

/** Deletes a previously stored upload, ignoring anything not ours. */
async function removeStoredFile(url: string | null): Promise<void> {
  const relative = relativePathFromUrl(url);
  if (!relative) return;
  try {
    await unlink(join(uploadRoot(), relative));
  } catch {
    // Already gone, or never written. Not worth failing the request over.
  }
}


export type ProductFormState = { error?: string; field?: string; created?: string };

/**
 * Creates a single product by hand.
 *
 * CSV import covers the initial catalogue; this covers the rest of the season,
 * when a shop adds one new item at a time and re-uploading a whole price list
 * would be absurd.
 */
export async function createProductAction(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  let input;
  try {
    input = parseProductForm({
      name: formData.get("name") ?? "",
      nameTa: formData.get("nameTa") ?? "",
      sku: formData.get("sku") ?? "",
      description: formData.get("description") ?? "",
      categoryId: formData.get("categoryId") ?? "",
      newCategory: formData.get("newCategory") ?? "",
      mrp: formData.get("mrp") ?? "",
      discountPct: formData.get("discountPct") ?? "0",
      unit: formData.get("unit") ?? "box",
      piecesPerUnit: formData.get("piecesPerUnit") ?? "",
      stock: formData.get("stock") ?? "",
      youtubeUrl: formData.get("youtubeUrl") ?? "",
      isActive: formData.get("isActive") === "on",
    });
  } catch (err) {
    if (err instanceof ProductError) return { error: err.message, field: err.field };
    throw err;
  }

  let createdName: string;
  try {
    createdName = await withAuth(async (tenantId) => {
      const limit = await productLimitFor(tenantId);

      return withTenant(getDb(), tenantId, async (tx) => {
        if (limit !== null) {
          const [{ value }] = await tx.select({ value: count() }).from(products);
          if (value >= limit) {
            throw new ProductError(
              `Your plan allows ${limit} products. Remove one, or ask about upgrading.`,
            );
          }
        }

        // A brand-new category typed into the form is created alongside the
        // product, so adding the season's first "Gift Boxes" item does not
        // require a separate trip through category management.
        let categoryId = input.categoryId;
        if (input.newCategory) {
          const existing = await tx.select().from(categories);
          const match = existing.find(
            (c: any) => c.name.toLowerCase() === input.newCategory!.toLowerCase(),
          );
          if (match) {
            categoryId = match.id;
          } else {
            const [created] = await tx
              .insert(categories)
              .values({
                tenantId,
                name: input.newCategory,
                sortOrder: existing.length,
              })
              .returning({ id: categories.id });
            categoryId = created.id;
          }
        }

        if (input.sku) {
          const [clash] = await tx
            .select({ id: products.id })
            .from(products)
            .where(eq(products.sku, input.sku));
          if (clash) {
            throw new ProductError(
              `Code "${input.sku}" is already used by another product.`,
              "sku",
            );
          }
        }

        // New products go to the end of the list by default.
        const [{ value: total }] = await tx.select({ value: count() }).from(products);

        await tx.insert(products).values({
          tenantId,
          categoryId: categoryId || null,
          name: input.name,
          nameTa: input.nameTa,
          sku: input.sku,
          description: input.description,
          mrp: input.mrp,
          discountPct: input.discountPct,
          unit: input.unit,
          piecesPerUnit: input.piecesPerUnit,
          stock: input.stock,
          youtubeUrl: input.youtubeUrl,
          isActive: input.isActive,
          sortOrder: total,
        });

        return input.name;
      });
    });
  } catch (err) {
    if (err instanceof ProductError) return { error: err.message, field: err.field };
    console.error("createProduct failed", err);
    return { error: "Could not save that product. Please try again." };
  }

  revalidatePath("/admin/products");
  revalidatePath("/");
  return { created: createdName };
}

/**
 * Product cap for the shop's current plan, or null when unlimited.
 *
 * Read through the platform connection: subscriptions are billing data, and a
 * shop must not be able to reach its own row to discover or change its cap.
 */
async function productLimitFor(tenantId: string): Promise<number | null> {
  const [current] = await getPlatformDb()
    .select({ plan: subscriptions.plan })
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, tenantId), isNull(subscriptions.cancelledAt)))
    .orderBy(desc(subscriptions.expiresAt))
    .limit(1);

  if (!current || !isPlanId(current.plan)) return null;
  return PLANS[current.plan].maxProducts;
}


export type SettingsState = { error?: string; field?: string; saved?: boolean };

/**
 * Shop settings, edited by the owner.
 *
 * The minimum order value especially: it is seeded at Rs 2,500 and, until this
 * existed, could not be changed. A shop whose catalogue does not reach that
 * total simply could not take orders -- the checkout button stayed disabled
 * with no way for the owner to fix it.
 */
export async function updateSettingsAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const read = (k: string) => String(formData.get(k) ?? "");

  let settings;
  try {
    settings = parseShopSettings({
      shopName: read("shopName"),
      minOrderValue: read("minOrderValue"),
      phone: read("phone"),
      whatsapp: read("whatsapp"),
      email: read("email"),
      addressLine: read("addressLine"),
      city: read("city"),
      state: read("state"),
      pincode: read("pincode"),
      gstin: read("gstin"),
      licenseNumber: read("licenseNumber"),
      upiId: read("upiId"),
      bankAccountName: read("bankAccountName"),
      bankAccountNumber: read("bankAccountNumber"),
      bankIfsc: read("bankIfsc"),
      tagline: read("tagline"),
      primaryColor: read("primaryColor"),
      accentColor: read("accentColor"),
      announcement: read("announcement"),
      announcementTone: read("announcementTone"),
      announcementDisplay: read("announcementDisplay"),
      aboutHeadline: read("aboutHeadline"),
      aboutIntro: read("aboutIntro"),
      aboutMission: read("aboutMission"),
      aboutVision: read("aboutVision"),
      // Absent entirely when the box is unchecked.
      announcementOn: formData.get("announcementOn") !== null,
    });
  } catch (err) {
    if (err instanceof SettingsError) return { error: err.message, field: err.field };
    throw err;
  }

  try {
    await withAuth(async (tenantId) => {
      await withTenant(getDb(), tenantId, async (tx) => {
        // The About photo is uploaded by its own form and lives in the same
        // JSON blob, so saving this form must carry it across rather than
        // overwrite it with an object that never had it.
        const [current] = await tx
          .select({ themeConfig: tenants.themeConfig })
          .from(tenants)
          .where(eq(tenants.id, tenantId));
        const keptImage = current?.themeConfig?.about?.imageUrl;

        const themeConfig = keptImage
          ? {
              ...settings.themeConfig,
              about: { ...(settings.themeConfig.about ?? {}), imageUrl: keptImage },
            }
          : settings.themeConfig;

        await tx
          .update(tenants)
          .set({ ...settings, themeConfig, updatedAt: new Date() })
          .where(eq(tenants.id, tenantId));
      });

      // The shop name is part of the cached tenant record used for routing.
      const [row] = await getDb()
        .select({ slug: tenants.slug, customDomain: tenants.customDomain })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      if (row) invalidateTenantCache(row);
    });
  } catch (err) {
    console.error("updateSettings failed", err);
    return { error: "Could not save those settings. Please try again." };
  }

  revalidatePath("/admin/settings");
  // "layout" purges every page under the shop, not just the storefront index.
  // The notice renders in the tenant layout, so an urgent message ("no
  // dispatch until Monday") has to reach the order and estimate pages too --
  // and it must not wait out the storefront's 5-minute revalidate window.
  revalidatePath("/", "layout");
  return { saved: true };
}

/** Updates an existing product. Mirrors createProductAction's validation. */
export async function updateProductAction(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const productId = String(formData.get("productId") ?? "");
  if (!productId) return { error: "Missing product." };

  let input;
  try {
    input = parseProductForm({
      name: formData.get("name") ?? "",
      nameTa: formData.get("nameTa") ?? "",
      sku: formData.get("sku") ?? "",
      description: formData.get("description") ?? "",
      categoryId: formData.get("categoryId") ?? "",
      newCategory: formData.get("newCategory") ?? "",
      mrp: formData.get("mrp") ?? "",
      discountPct: formData.get("discountPct") ?? "0",
      unit: formData.get("unit") ?? "box",
      piecesPerUnit: formData.get("piecesPerUnit") ?? "",
      stock: formData.get("stock") ?? "",
      youtubeUrl: formData.get("youtubeUrl") ?? "",
      isActive: formData.get("isActive") === "on",
    });
  } catch (err) {
    if (err instanceof ProductError) return { error: err.message, field: err.field };
    throw err;
  }

  try {
    await withAuth((tenantId) =>
      withTenant(getDb(), tenantId, async (tx) => {
        // RLS scopes this, so another shop's product id matches nothing.
        const [existing] = await tx
          .select({ id: products.id })
          .from(products)
          .where(eq(products.id, productId));
        if (!existing) throw new ProductError("That product no longer exists.");

        let categoryId = input.categoryId;
        if (input.newCategory) {
          const all = await tx.select().from(categories);
          const match = all.find(
            (c: any) => c.name.toLowerCase() === input.newCategory!.toLowerCase(),
          );
          categoryId = match
            ? match.id
            : (
                await tx
                  .insert(categories)
                  .values({ tenantId, name: input.newCategory, sortOrder: all.length })
                  .returning({ id: categories.id })
              )[0].id;
        }

        if (input.sku) {
          const clash = await tx
            .select({ id: products.id })
            .from(products)
            .where(eq(products.sku, input.sku));
          if (clash.some((c: any) => c.id !== productId)) {
            throw new ProductError(
              `Code "${input.sku}" is already used by another product.`,
              "sku",
            );
          }
        }

        await tx
          .update(products)
          .set({
            categoryId: categoryId || null,
            name: input.name,
            nameTa: input.nameTa,
            sku: input.sku,
            description: input.description,
            mrp: input.mrp,
            discountPct: input.discountPct,
            unit: input.unit,
            piecesPerUnit: input.piecesPerUnit,
            stock: input.stock,
            youtubeUrl: input.youtubeUrl,
            isActive: input.isActive,
            updatedAt: new Date(),
          })
          .where(eq(products.id, productId));
      }),
    );
  } catch (err) {
    if (err instanceof ProductError) return { error: err.message, field: err.field };
    console.error("updateProduct failed", err);
    return { error: "Could not save that product. Please try again." };
  }

  revalidatePath("/admin/products");
  revalidatePath("/");
  return { created: input.name };
}

export async function deleteProductAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "");

  await withAuth((tenantId) =>
    withTenant(getDb(), tenantId, async (tx) => {
      // Existing order lines keep their own snapshot of the product, so the
      // history on past estimates survives the delete.
      const [existing] = await tx
        .select({ imageUrl: products.imageUrl })
        .from(products)
        .where(eq(products.id, productId));
      if (!existing) return;

      await tx.delete(products).where(eq(products.id, productId));
      await removeStoredFile(existing.imageUrl);
    }),
  );

  revalidatePath("/admin/products");
  revalidatePath("/");
}


export type AboutImageState = { error?: string; ok?: boolean };

/**
 * The photo beside the About text.
 *
 * Same rules as a product photo -- magic-byte sniffing, generated filename, old
 * file removed on replace -- because it is the same untrusted upload arriving
 * through a different form.
 */
export async function uploadAboutImageAction(
  _prev: AboutImageState,
  formData: FormData,
): Promise<AboutImageState> {
  const file = formData.get("image");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a photo to upload." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: `Images must be under ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))} MB.` };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateImage(bytes, file.size);
  if (!check.ok) return { error: check.message };

  try {
    await withAuth(async (tenantId) => {
      const relative = buildImagePath(tenantId, check.extension);
      const absolute = join(uploadRoot(), relative);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, bytes);

      await withTenant(getDb(), tenantId, async (tx) => {
        const [current] = await tx
          .select({ themeConfig: tenants.themeConfig })
          .from(tenants)
          .where(eq(tenants.id, tenantId));
        const theme = current?.themeConfig ?? {};
        const previous = theme.about?.imageUrl ?? null;

        await tx
          .update(tenants)
          .set({
            themeConfig: {
              ...theme,
              about: { ...(theme.about ?? {}), imageUrl: publicUrlFor(relative) },
            },
            updatedAt: new Date(),
          })
          .where(eq(tenants.id, tenantId));

        await removeStoredFile(previous);
      });
    });
  } catch (err) {
    console.error("uploadAboutImage failed", err);
    return { error: "Could not save that photo. Please try again." };
  }

  revalidatePath("/admin/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeAboutImageAction() {
  await withAuth((tenantId) =>
    withTenant(getDb(), tenantId, async (tx) => {
      const [current] = await tx
        .select({ themeConfig: tenants.themeConfig })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      const theme = current?.themeConfig ?? {};
      if (!theme.about?.imageUrl) return;

      const { imageUrl, ...rest } = theme.about;
      await tx
        .update(tenants)
        .set({ themeConfig: { ...theme, about: rest }, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId));

      await removeStoredFile(imageUrl);
    }),
  );

  revalidatePath("/admin/settings");
  revalidatePath("/", "layout");
}
