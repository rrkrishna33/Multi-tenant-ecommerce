import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb, withTenant } from "@/db";
import { products, categories } from "@/db/schema";
import { getTenantByKey } from "@/lib/tenant-db";
import { formatInr, salePrice } from "@/lib/pricing";
import { toggleProductAction } from "../actions";
import { ImportForm } from "./import-form";
import { ImageCell } from "./image-cell";
import { ProductForm } from "./product-form";
import { EditProduct } from "./edit-product";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: key } = await params;
  const tenant = await getTenantByKey(key);
  if (!tenant) notFound();

  const categoryOptions = await withTenant(getDb(), tenant.id, (tx) =>
    tx
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .orderBy(asc(categories.sortOrder)),
  );

  const rows = await withTenant(getDb(), tenant.id, (tx) =>
    tx
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        mrp: products.mrp,
        discountPct: products.discountPct,
        unit: products.unit,
        stock: products.stock,
        imageUrl: products.imageUrl,
        nameTa: products.nameTa,
        description: products.description,
        categoryId: products.categoryId,
        piecesPerUnit: products.piecesPerUnit,
        youtubeUrl: products.youtubeUrl,
        isActive: products.isActive,
        categoryName: categories.name,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .orderBy(asc(categories.sortOrder), asc(products.sortOrder)),
  );

  return (
    <>
      <h2>Products</h2>
      <ProductForm categories={categoryOptions} />
      <ImportForm />

      <p className="muted">
        {rows.length} product{rows.length === 1 ? "" : "s"} ·{" "}
        {rows.filter((r: any) => r.isActive).length} live on the storefront
      </p>

      {rows.length === 0 ? (
        <div className="notice">
          No products yet. Upload your price list above to get your shop online.
        </div>
      ) : (
        <table className="order-table">
          <thead>
            <tr>
              <th>Photo</th>
              <th>Product</th>
              <th>Category</th>
              <th className="num">MRP</th>
              <th className="num">Discount</th>
              <th className="num">Sale price</th>
              <th className="num">Stock</th>
              <th className="num">Live</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p: any) => (
              <tr key={p.id} style={{ opacity: p.isActive ? 1 : 0.5 }}>
                <td>
                  <ImageCell
                    productId={p.id}
                    imageUrl={p.imageUrl}
                    productName={p.name}
                  />
                </td>
                <td>
                  <strong>{p.name}</strong>
                  {p.sku ? <div className="muted">{p.sku}</div> : null}
                  <EditProduct
                    product={{
                      id: p.id,
                      name: p.name,
                      nameTa: p.nameTa,
                      sku: p.sku,
                      description: p.description,
                      categoryId: p.categoryId,
                      mrp: p.mrp,
                      discountPct: p.discountPct,
                      unit: p.unit,
                      piecesPerUnit: p.piecesPerUnit,
                      stock: p.stock,
                      youtubeUrl: p.youtubeUrl,
                      isActive: p.isActive,
                    }}
                    categories={categoryOptions}
                  />
                </td>
                <td>{p.categoryName ?? "-"}</td>
                <td className="num">{formatInr(p.mrp)}</td>
                <td className="num">{p.discountPct}%</td>
                <td className="num">{formatInr(salePrice(p.mrp, p.discountPct))}</td>
                <td className="num">{p.stock ?? "-"}</td>
                <td className="num">
                  <form action={toggleProductAction}>
                    <input type="hidden" name="productId" value={p.id} />
                    <button className="btn secondary" type="submit" style={{ padding: "4px 10px" }}>
                      {p.isActive ? "Hide" : "Show"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
