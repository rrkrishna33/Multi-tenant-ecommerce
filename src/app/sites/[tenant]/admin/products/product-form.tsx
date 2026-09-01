"use client";

import { useActionState, useState, useRef, useEffect } from "react";
import { createProductAction, type ProductFormState } from "../actions";
import { UNITS } from "@/lib/products";
import { formatInr, salePrice } from "@/lib/pricing";

export type CategoryOption = { id: string; name: string };

const NEW_CATEGORY = "__new__";

export function ProductForm({ categories }: { categories: CategoryOption[] }) {
  const [state, action, pending] = useActionState<ProductFormState, FormData>(
    createProductAction,
    {},
  );
  const [category, setCategory] = useState("");
  const [mrp, setMrp] = useState("");
  const [discount, setDiscount] = useState("0");
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the form after a save so the next item can be typed straight in --
  // a shop adding ten products should not have to delete the previous one.
  useEffect(() => {
    if (state.created) {
      formRef.current?.reset();
      setMrp("");
      setDiscount("0");
      setCategory("");
    }
  }, [state.created]);

  // Live sale price, because MRP-minus-discount is not arithmetic a shop owner
  // should have to do in their head while typing.
  let preview: string | null = null;
  try {
    const paise = Math.round(Number(mrp.replace(/[^\d.]/g, "")) * 100);
    const pct = Number(discount);
    if (paise > 0 && Number.isInteger(pct) && pct >= 0 && pct <= 100) {
      preview = formatInr(salePrice(paise, pct));
    }
  } catch {
    preview = null;
  }

  const err = (field: string) =>
    state.field === field ? (
      <div className="muted" style={{ color: "var(--err)" }}>
        {state.error}
      </div>
    ) : null;

  // A <details> rather than JS-toggled state: the form is then present in the
  // server-rendered HTML, so it still works if the page's JavaScript has not
  // loaded -- which on a shop's phone, on rural mobile data in October, is not
  // a hypothetical.
  return (
    <details className="card" open={Boolean(state.error || state.created)}>
      <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 16 }}>
        Add a product
      </summary>
      <form ref={formRef} action={action} style={{ marginTop: 16 }}>

      {state.created ? (
        <div className="notice ok">Added &ldquo;{state.created}&rdquo;. Add another below.</div>
      ) : null}
      {state.error && !state.field ? <div className="notice error">{state.error}</div> : null}

      <div className="grid-2">
        <div className="field">
          <label htmlFor="name">Product name</label>
          <input id="name" name="name" required placeholder="Flower Pot Big" />
          {err("name")}
        </div>
        <div className="field">
          <label htmlFor="nameTa">Tamil name (optional)</label>
          <input id="nameTa" name="nameTa" placeholder="பூச்சட்டி" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="categoryId">Category</label>
        {/* The select drives the UI only; the submitted value comes from the
            hidden field, so choosing "New category" posts an empty id rather
            than the sentinel. */}
        <input
          type="hidden"
          name="categoryId"
          value={category === NEW_CATEGORY ? "" : category}
        />
        <select
          id="categoryId"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
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
          <label htmlFor="newCategory">New category name</label>
          <input id="newCategory" name="newCategory" required placeholder="Gift Boxes" />
        </div>
      ) : null}

      <div className="grid-2">
        <div className="field">
          <label htmlFor="mrp">MRP (rupees)</label>
          <input
            id="mrp"
            name="mrp"
            required
            inputMode="decimal"
            placeholder="500"
            value={mrp}
            onChange={(e) => setMrp(e.target.value)}
          />
          {err("mrp")}
        </div>
        <div className="field">
          <label htmlFor="discountPct">Discount %</label>
          <input
            id="discountPct"
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
          <label htmlFor="unit">Sold by</label>
          <select id="unit" name="unit" defaultValue="box">
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="piecesPerUnit">Pieces per unit (optional)</label>
          <input id="piecesPerUnit" name="piecesPerUnit" inputMode="numeric" placeholder="10" />
          {err("piecesPerUnit")}
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="sku">Product code (optional)</label>
          <input id="sku" name="sku" placeholder="FP01" />
          {err("sku")}
        </div>
        <div className="field">
          <label htmlFor="stock">Stock (optional)</label>
          <input id="stock" name="stock" inputMode="numeric" placeholder="leave blank" />
          <div className="muted">Leave blank if you do not track stock for this item.</div>
          {err("stock")}
        </div>
      </div>

      <div className="field">
        <label htmlFor="youtubeUrl">YouTube demo link (optional)</label>
        <input id="youtubeUrl" name="youtubeUrl" placeholder="https://youtu.be/..." />
        {err("youtubeUrl")}
      </div>

      <div className="field">
        <label htmlFor="description">Description (optional)</label>
        <textarea id="description" name="description" rows={2} />
      </div>

      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input type="checkbox" name="isActive" defaultChecked />
        <span>Show on the storefront straight away</span>
      </label>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Saving..." : "Add product"}
      </button>
      <p className="muted" style={{ marginTop: 8 }}>
        You can add a photo from the list below once the product is saved.
      </p>
      </form>
    </details>
  );
}
