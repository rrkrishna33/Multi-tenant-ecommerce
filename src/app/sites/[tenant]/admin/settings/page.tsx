import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { getDb, withTenant } from "@/db";
import { tenants, products } from "@/db/schema";
import { getTenantByKey } from "@/lib/tenant-db";
import { salePrice } from "@/lib/pricing";
import { settingsWarnings } from "@/lib/shop-settings";
import { SettingsForm } from "./form";
import { AboutImage } from "./about-image";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: key } = await params;
  const resolved = await getTenantByKey(key);
  if (!resolved) notFound();

  const { shop, cheapest } = await withTenant(getDb(), resolved.id, async (tx) => {
    const [shop] = await tx.select().from(tenants).where(eq(tenants.id, resolved.id));
    const live = await tx
      .select({ mrp: products.mrp, discountPct: products.discountPct })
      .from(products)
      .where(eq(products.isActive, true));
    const prices = live.map((p: any) => salePrice(p.mrp, p.discountPct)).filter((n: number) => n > 0);
    return { shop, cheapest: prices.length ? Math.min(...prices) : null };
  });

  const warnings = settingsWarnings(
    {
      minOrderValue: shop.minOrderValue,
      upiId: shop.upiId,
      bankAccountNumber: shop.bankAccountNumber,
      phone: shop.phone,
    },
    cheapest,
  );

  return (
    <>
      <h2>Shop settings</h2>
      {warnings.length > 0 ? (
        <div className="notice">
          <strong>Worth fixing:</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <SettingsForm shop={JSON.parse(JSON.stringify(shop))} cheapest={cheapest} />
      {/* Outside the settings form: a form cannot contain another form. */}
      <AboutImage imageUrl={shop.themeConfig?.about?.imageUrl ?? null} />
    </>
  );
}
