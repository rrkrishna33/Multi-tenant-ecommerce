import { notFound } from "next/navigation";
import { eq, asc, and } from "drizzle-orm";
import { getDb, withTenant } from "@/db";
import { products, categories, tenants } from "@/db/schema";
import { getTenantByKey } from "@/lib/tenant-db";
import { OrderTable, type StoreProduct } from "./order-table";
import { AboutSection } from "./about-section";

export const revalidate = 300;

export default async function StorefrontPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: key } = await params;
  const resolved = await getTenantByKey(key);
  if (!resolved) notFound();

  const db = getDb();

  const { rows, shop } = await withTenant(db, resolved.id, async (tx) => {
    const rows = await tx
      .select({
        id: products.id,
        name: products.name,
        nameTa: products.nameTa,
        unit: products.unit,
        piecesPerUnit: products.piecesPerUnit,
        mrp: products.mrp,
        discountPct: products.discountPct,
        youtubeUrl: products.youtubeUrl,
        imageUrl: products.imageUrl,
        categoryName: categories.name,
        categorySort: categories.sortOrder,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(products.isActive, true))
      .orderBy(asc(categories.sortOrder), asc(products.sortOrder), asc(products.name));

    const [shop] = await tx.select().from(tenants).where(eq(tenants.id, resolved.id));
    return { rows, shop };
  });

  const about = shop?.themeConfig?.about;

  if (rows.length === 0) {
    return (
      <>
        <main className="wrap" style={{ paddingTop: 32 }}>
          <div className="notice">
            This shop has not published its price list yet. Please check back soon
            {shop?.phone ? `, or call ${shop.phone}` : ""}.
          </div>
        </main>
        <AboutSection about={about} shop={shop} />
      </>
    );
  }

  const storeProducts: StoreProduct[] = rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    nameTa: r.nameTa,
    unit: r.unit,
    piecesPerUnit: r.piecesPerUnit,
    mrp: r.mrp,
    discountPct: r.discountPct,
    youtubeUrl: r.youtubeUrl,
    imageUrl: r.imageUrl,
    categoryName: r.categoryName ?? "Other Items",
  }));

  return (
    <>
      <OrderTable
        products={storeProducts}
        minOrderValue={shop.minOrderValue}
        upiId={shop.upiId}
      />
      <AboutSection about={about} shop={shop} />
    </>
  );
}
