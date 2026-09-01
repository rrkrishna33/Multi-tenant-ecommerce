import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, withTenant } from "@/db";
import { orders, orderItems, tenants } from "@/db/schema";
import { getTenantByKey } from "@/lib/tenant-db";
import { formatInr } from "@/lib/pricing";
import { formatEstimateNumber } from "@/lib/orders";
import { PrintButton } from "../../print-button";

/**
 * Never cached. The estimate changes when the shop records a payment or adds
 * dispatch details, and a customer refreshing the link they were sent must see
 * the current state rather than whatever was rendered first.
 */
export const dynamic = "force-dynamic";

/**
 * The estimate. This page IS the deliverable of checkout: the customer prints
 * or screenshots it, pays by UPI or bank transfer, and sends the reference
 * back to the shop.
 */
export default async function EstimatePage({
  params,
}: {
  params: Promise<{ tenant: string; orderId: string }>;
}) {
  const { tenant: key, orderId } = await params;
  const resolved = await getTenantByKey(key);
  if (!resolved) notFound();

  const db = getDb();
  const data = await withTenant(db, resolved.id, async (tx) => {
    // RLS scopes this to the shop, so an order id from another shop simply
    // does not exist here.
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order) return null;
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const [shop] = await tx.select().from(tenants).where(eq(tenants.id, resolved.id));
    return { order, items, shop };
  });

  if (!data) notFound();
  const { order, items, shop } = data;

  const totalMrp = items.reduce((s: number, i: any) => s + i.mrp * i.quantity, 0);
  const savings = totalMrp - order.subtotal;

  return (
    <main className="wrap" style={{ paddingTop: 24, paddingBottom: 60 }}>
      <div className="notice ok no-print">
        <strong>Order received.</strong> Your estimate is below. Pay using the details
        shown, then send the payment reference to the shop on WhatsApp to confirm.
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>{shop.shopName}</h2>
            <div className="muted">
              {shop.addressLine}
              {shop.city ? `, ${shop.city}` : ""}
              {shop.pincode ? ` - ${shop.pincode}` : ""}
            </div>
            {shop.phone ? <div className="muted">Phone: {shop.phone}</div> : null}
            {shop.gstin ? <div className="muted">GSTIN: {shop.gstin}</div> : null}
            {shop.licenseNumber ? (
              <div className="muted">Licence: {shop.licenseNumber}</div>
            ) : null}
          </div>
          <div style={{ textAlign: "right" }}>
            <h3 style={{ margin: 0 }}>ESTIMATE</h3>
            <div>
              <strong>{formatEstimateNumber(order.orderNumber)}</strong>
            </div>
            <div className="muted">
              {new Date(order.createdAt).toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </div>
            <div style={{ marginTop: 6 }}>
              <span className={`badge ${order.status === "paid" ? "paid" : "pending"}`}>
                {order.status === "paid" ? "Payment received" : "Awaiting payment"}
              </span>
            </div>
          </div>
        </div>

        <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "16px 0" }} />

        <div>
          <strong>Deliver to</strong>
          <div>{order.customerName}</div>
          <div className="muted">{order.customerPhone}</div>
          <div className="muted">
            {order.addressLine}, {order.city}, {order.state} - {order.pincode}
          </div>
          {order.notes ? <div className="muted">Note: {order.notes}</div> : null}
        </div>

        <table className="order-table" style={{ marginTop: 20 }}>
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th className="num">Rate</th>
              <th className="num">Qty</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: any, i: number) => (
              <tr key={item.id}>
                <td>{i + 1}</td>
                <td>
                  {item.productName}
                  <div className="muted">
                    Per {item.unit} · MRP {formatInr(item.mrp)} ({item.discountPct}% off)
                  </div>
                </td>
                <td className="num">{formatInr(item.unitPrice)}</td>
                <td className="num">{item.quantity}</td>
                <td className="num">{formatInr(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {savings > 0 ? (
              <tr>
                <td colSpan={4} className="num">
                  Total MRP
                </td>
                <td className="num strike">{formatInr(totalMrp)}</td>
              </tr>
            ) : null}
            <tr>
              <td colSpan={4} className="num">
                <strong>Total payable</strong>
              </td>
              <td className="num">
                <strong>{formatInr(order.subtotal)}</strong>
              </td>
            </tr>
            {savings > 0 ? (
              <tr>
                <td colSpan={4} className="num savings">
                  You save
                </td>
                <td className="num savings">{formatInr(savings)}</td>
              </tr>
            ) : null}
          </tfoot>
        </table>
      </div>

      {order.status !== "paid" ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>How to pay</h3>
          {shop.upiId ? (
            <p>
              <strong>UPI:</strong> {shop.upiId}
            </p>
          ) : null}
          {shop.bankAccountNumber ? (
            <p>
              <strong>Bank transfer</strong>
              <br />
              {shop.bankAccountName}
              <br />
              A/c {shop.bankAccountNumber}
              <br />
              IFSC {shop.bankIfsc}
            </p>
          ) : null}
          {!shop.upiId && !shop.bankAccountNumber ? (
            <p className="muted">
              Please contact the shop{shop.phone ? ` on ${shop.phone}` : ""} for payment
              details.
            </p>
          ) : null}
          <p className="muted">
            After paying, send the transaction reference to the shop
            {shop.whatsapp ? ` on WhatsApp ${shop.whatsapp}` : ""} quoting{" "}
            {formatEstimateNumber(order.orderNumber)}.
          </p>
        </div>
      ) : null}

      {order.transportLrNumber ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Dispatch</h3>
          <p>
            Sent via {order.transportName}
            <br />
            LR number: {order.transportLrNumber}
          </p>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }} className="no-print">
        <a className="btn" href={`/order/${order.id}/pdf`}>
          Download PDF
        </a>
        <PrintButton />
      </div>
    </main>
  );
}
