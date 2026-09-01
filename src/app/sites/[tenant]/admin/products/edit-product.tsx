"use client";

import { useActionState, useState } from "react";
import { updateProductAction, deleteProductAction, type ProductFormState } from "../actions";
import { UNITS } from "@/lib/products";
import { formatInr, salePrice } from "@/lib/pricing";
import type { CategoryOption } from "./product-form";

export type EditableProduct = {
  id: string;
  name: string;
  nameTa: string | null;
  sku: string | null;
  description: string | null;
  categoryId: string | null;
  mrp: number;
  discountPct: number;
  unit: string;
  piecesPerUnit: number | null;
  stock: number | null;
  youtubeUrl: string | null;
  isActive: boolean;
};

const NEW_CATEGORY = "__new__";

/**
 * Inline edit for one product.
 *
 * A shop that can create a product but not correct it has to fix a typo'd
 * price by re-importing a CSV row -- which is exactly the moment they stop
 * trusting the admin.
 */
export function EditProduct({
  product,
  categories,
}: {
  product: EditableProduct;
  categories: CategoryOption[];
}) {
  const [state, action, pending] = useActionState<ProductFormState, FormData>(
    updateProductAction,
    {},
  );
  const [category, setCategory] = useState(product.categoryId ?? "");
  const [mrp, setMrp] = useState((product.mrp / 100).toFixed(2));
  const [discount, setDiscount] = useState(String(product.discountPct));
  const [confirming, setConfirming] = useState(false);

  const paise = Math.round(Number(mrp.replace(/[^\d.]/g, "")) * 100);
  const pct = Number(discount);
  const preview =
    paise > 0 && Number.isInteger(pct) && pct >= 0 && pct <= 100
      ? formatInr(salePrice(paise, pct))
      : null;

  const err = (field: string) =>
    state.field === field ? (
      <div className="muted" style={{ color: "var(--err)" }}>
        {state.error}
      </div>
    ) : null;

  return (
    <details style={{ marginTop: 6 }}>
      <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>Edit</summary>

      <form action={action} style={{ marginTop: 10 }}>
        <input type="hidden" name="productId" value={product.id} />
        <input
          type="hidden"
          name="categoryId"
          value={category === NEW_CATEGORY ? "" : category}
        />

        {state.created ? <div className="notice ok">Saved.</div> : null}
        {state.error && !state.field ? <div className="notice error">{state.error}</div> : null}

        <div className="grid-2">
          <div className="field">
            <label>Name</label>
            <input name="name" required defaultValue={product.name} />
            {err("name")}
          </div>
          <div className="field">
            <label>Tamil name</label>
            <input name="nameTa" defaultValue={product.nameTa ?? ""} />
          </div>
        </div>

        <div className="field">
          <label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NEW_CATEGORY}>+ New category...</option>
          </select>
        </div>

        {category === NEW_CATEGORY ? (
          <div className="field">
            <label>New category name</label>
            <input name="newCategory" required />
          </div>
        ) : null}

        <div className="grid-2">
          <div className="field">
            <label>MRP (rupees)</label>
            <input
              name="mrp"
              required
              inputMode="decimal"
              value={mrp}
              onChange={(e) => setMrp(e.target.value)}
            />
            {err("mrp")}
          </div>
          <div className="field">
            <label>Discount %</label>
            <input
              name="discountPct"
              required
              inputMode="numeric"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
            {err("discountPct")}
          </div>
        </div>

        {preview ? (
          <p style={{ marginTop: -4 }}>
            Customers pay <strong>{preview}</strong>
          </p>
        ) : null}

        <div className="grid-2">
          <div className="field">
            <label>Sold by</label>
            <select name="unit" defaultValue={product.unit}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Pieces per unit</label>
            <input
              name="piecesPerUnit"
              inputMode="numeric"
              defaultValue={product.piecesPerUnit ?? ""}
            />
            {err("piecesPerUnit")}
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Product code</label>
            <input name="sku" defaultValue={product.sku ?? ""} />
            {err("sku")}
          </div>
          <div className="field">
            <label>Stock</label>
            <input
              name="stock"
              inputMode="numeric"
              defaultValue={product.stock ?? ""}
              placeholder="blank = untracked"
            />
            {err("stock")}
          </div>
        </div>

        <div className="field">
          <label>YouTube link</label>
          <input name="youtubeUrl" defaultValue={product.youtubeUrl ?? ""} />
          {err("youtubeUrl")}
        </div>

        <div className="field">
          <label>Description</label>
          <textarea name="description" rows={2} defaultValue={product.description ?? ""} />
        </div>

        <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <input type="checkbox" name="isActive" defaultChecked={product.isActive} />
          <span>Show on the storefront</span>
        </label>

        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save changes"}
        </button>
      </form>

      <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
        {confirming ? (
          <form action={deleteProductAction}>
            <input type="hidden" name="productId" value={product.id} />
            <p className="muted" style={{ marginTop: 0 }}>
              Delete &ldquo;{product.name}&rdquo; permanently? Past estimates keep their own
              copy of it, so order history is unaffected. Hiding it instead keeps it
              available to re-list later.
            </p>
            <button className="btn" type="submit" style={{ background: "var(--err)" }}>
              Yes, delete it
            </button>{" "}
            <button type="button" className="btn secondary" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="muted"
            onClick={() => setConfirming(true)}
            style={{
              background: "none",
              border: 0,
              cursor: "pointer",
              textDecoration: "underline",
              color: "var(--err)",
              fontSize: 12,
            }}
          >
            Delete this product
          </button>
        )}
      </div>
    </details>
  );
}
