"use client";

import { Fragment, useEffect, useMemo, useState, useActionState } from "react";
import { formatInr, salePrice } from "@/lib/pricing";
import { submitOrder, type CheckoutState } from "./actions";

export type StoreProduct = {
  id: string;
  name: string;
  nameTa: string | null;
  unit: string;
  piecesPerUnit: number | null;
  mrp: number;
  discountPct: number;
  categoryName: string;
  youtubeUrl: string | null;
  imageUrl: string | null;
};

type Props = {
  products: StoreProduct[];
  minOrderValue: number;
  upiId: string | null;
};

/**
 * The bulk order table.
 *
 * Deliberately not a card grid with per-product "Add to cart". Customers here
 * work down a full price list filling in quantities for 40+ items in one pass,
 * exactly as they would on a paper order form, and every extra click per line
 * is a click times forty.
 */
export function OrderTable({ products, minOrderValue, upiId }: Props) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [state, formAction, pending] = useActionState<CheckoutState, FormData>(submitOrder, {});

  const priced = useMemo(
    () =>
      products.map((p) => ({
        ...p,
        unitPrice: salePrice(p.mrp, p.discountPct),
      })),
    [products],
  );

  const totals = useMemo(() => {
    let subtotal = 0;
    let mrpTotal = 0;
    let count = 0;
    for (const p of priced) {
      const qty = quantities[p.id] ?? 0;
      if (qty > 0) {
        subtotal += p.unitPrice * qty;
        mrpTotal += p.mrp * qty;
        count += qty;
      }
    }
    return { subtotal, savings: mrpTotal - subtotal, count };
  }, [priced, quantities]);

  const meetsMinimum = totals.subtotal >= minOrderValue;

  // Reopen the panel when the server rejects the submission, so the customer
  // sees the reason rather than a form that silently closed on them.
  useEffect(() => {
    if (state.error) setCheckoutOpen(true);
  }, [state.error]);

  function setQty(id: string, raw: string) {
    const n = raw === "" ? 0 : Math.max(0, Math.min(9999, Math.floor(Number(raw))));
    setQuantities((q) => ({ ...q, [id]: Number.isFinite(n) ? n : 0 }));
  }

  // Group into the category sections a printed price list uses.
  const grouped = useMemo(() => {
    const map = new Map<string, typeof priced>();
    for (const p of priced) {
      const list = map.get(p.categoryName) ?? [];
      list.push(p);
      map.set(p.categoryName, list);
    }
    return [...map.entries()];
  }, [priced]);

  const selectedItems = priced
    .filter((p) => (quantities[p.id] ?? 0) > 0)
    .map((p) => ({ productId: p.id, quantity: quantities[p.id] }));

  return (
    <>
      <div className="banner">
        Minimum order {formatInr(minOrderValue)} &middot; Delivery across Tamil Nadu by
        licensed road transport
      </div>

      <main className="wrap" style={{ paddingBottom: 120 }}>
        {state.error ? <div className="notice error">{state.error}</div> : null}

        <table className="order-table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">MRP</th>
              <th className="num">Our Price</th>
              <th className="num">Qty</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(([category, items]) => (
              <Fragment key={category}>
                <tr className="cat-row">
                  <td colSpan={5}>{category}</td>
                </tr>
                {items.map((p) => {
                  const qty = quantities[p.id] ?? 0;
                  return (
                    <tr key={p.id}>
                      <td>
                        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                          {p.imageUrl ? (
                            <img
                              src={p.imageUrl}
                              alt={p.name}
                              width={48}
                              height={48}
                              loading="lazy"
                              decoding="async"
                              className="row-thumb"
                            />
                          ) : null}
                          <div>
                            <strong>{p.name}</strong>
                            {p.nameTa ? <div className="muted">{p.nameTa}</div> : null}
                            <div className="muted">
                              Per {p.unit}
                              {p.piecesPerUnit ? ` of ${p.piecesPerUnit}` : ""}
                              {p.youtubeUrl ? (
                                <>
                                  {" · "}
                                  <a href={p.youtubeUrl} target="_blank" rel="noreferrer">
                                    Watch
                                  </a>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="num">
                        <span className="strike">{formatInr(p.mrp)}</span>
                        <div className="muted">{p.discountPct}% off</div>
                      </td>
                      <td className="num">
                        <strong>{formatInr(p.unitPrice)}</strong>
                      </td>
                      <td className="num">
                        <input
                          className="qty-input"
                          type="number"
                          min={0}
                          max={9999}
                          inputMode="numeric"
                          aria-label={`Quantity for ${p.name}`}
                          value={qty === 0 ? "" : qty}
                          onChange={(e) => setQty(p.id, e.target.value)}
                        />
                      </td>
                      <td className="num">
                        <span className="row-total">
                          {qty > 0 ? formatInr(p.unitPrice * qty) : "-"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>

        {/* A <details> rather than JS-only state: the panel stays collapsed so
            it does not push the price list down, but it is present in the
            server HTML and can be opened natively even before the page's
            JavaScript has loaded. */}
        <details
          className="card"
          id="checkout"
          open={checkoutOpen}
          onToggle={(e) => setCheckoutOpen(e.currentTarget.open)}
        >
          <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 16 }}>
            Delivery details
          </summary>
          <form action={formAction} style={{ marginTop: 16 }}>
            <input type="hidden" name="items" value={JSON.stringify(selectedItems)} />

            <div className="grid-2">
              <div className="field">
                <label>Full name</label>
                <input name="customerName" required minLength={2} />
              </div>
              <div className="field">
                <label>Mobile number</label>
                <input name="customerPhone" required placeholder="98420 12345" />
              </div>
            </div>

            <div className="field">
              <label>Email (optional)</label>
              <input name="customerEmail" type="email" />
            </div>

            <div className="field">
              <label>Address</label>
              <textarea name="addressLine" required rows={3} />
            </div>

            <div className="grid-2">
              <div className="field">
                <label>City / Town</label>
                <input name="city" required />
              </div>
              <div className="field">
                <label>PIN code</label>
                <input name="pincode" required inputMode="numeric" maxLength={6} />
              </div>
            </div>

            <div className="field">
              <label>State</label>
              <input name="state" defaultValue="Tamil Nadu" required />
            </div>

            <div className="field">
              <label>Notes for the shop (optional)</label>
              <textarea name="notes" rows={2} />
            </div>

            <p className="muted">
              You will receive an estimate with payment details. Pay by UPI
              {upiId ? ` (${upiId})` : ""} or bank transfer, then send the reference to
              the shop to confirm your order.
            </p>

            <button className="btn" type="submit" disabled={pending || !meetsMinimum}>
              {pending ? "Placing order..." : "Get estimate"}
            </button>
            {!meetsMinimum ? (
              <p className="muted" style={{ marginTop: 8 }}>
                Add {formatInr(Math.max(0, minOrderValue - totals.subtotal))} more to
                reach the {formatInr(minOrderValue)} minimum before placing the order.
              </p>
            ) : null}
          </form>
        </details>
      </main>

      <div className="cart-bar no-print">
        <div className="wrap">
          <div className="totals">
            <div className="grand">{formatInr(totals.subtotal)}</div>
            <div className="muted">
              {totals.count} item{totals.count === 1 ? "" : "s"}
              {totals.savings > 0 ? (
                <span className="savings"> · You save {formatInr(totals.savings)}</span>
              ) : null}
            </div>
          </div>

          <div style={{ marginLeft: "auto" }}>
            {!meetsMinimum ? (
              <div className="muted" style={{ marginBottom: 4 }}>
                Add {formatInr(minOrderValue - totals.subtotal)} more to reach the minimum
              </div>
            ) : null}
            {/* Deliberately never disabled: a button that does nothing when
                clicked is the reason this flow looked broken. It always opens
                the panel, which explains the minimum if one is not met. */}
            <button
              className="btn"
              onClick={() => {
                setCheckoutOpen(true);
                requestAnimationFrame(() =>
                  document
                    .getElementById("checkout")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                );
              }}
            >
              Proceed to checkout
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
