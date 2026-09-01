"use client";

import { useActionState, useState } from "react";
import { formatInr } from "@/lib/pricing";
import { markPaidAction, updateOrderStatusAction } from "../actions";

type Order = {
  id: string;
  estimateNumber: string;
  customerName: string;
  customerPhone: string;
  city: string;
  pincode: string;
  subtotal: number;
  status: string;
  paymentRef: string | null;
  transportName: string | null;
  transportLrNumber: string | null;
  createdAt: string;
};

export function OrderRow({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  const [payState, payAction, payPending] = useActionState(markPaidAction, {} as { error?: string });

  return (
    <div className="card">
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong>{order.estimateNumber}</strong>
        <span className={`badge ${order.status === "pending" ? "pending" : "paid"}`}>
          {order.status}
        </span>
        <span>
          {order.customerName} · {order.customerPhone}
        </span>
        <span className="muted">
          {order.city} - {order.pincode}
        </span>
        <span style={{ marginLeft: "auto", fontWeight: 700 }}>{formatInr(order.subtotal)}</span>
      </div>

      <div className="muted" style={{ marginTop: 4 }}>
        {new Date(order.createdAt).toLocaleString("en-IN")}
        {order.paymentRef ? ` · Ref ${order.paymentRef}` : ""}
        {order.transportLrNumber
          ? ` · ${order.transportName} LR ${order.transportLrNumber}`
          : ""}
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <a className="btn secondary" href={`/order/${order.id}`} target="_blank">
          View estimate
        </a>
        <a className="btn secondary" href={`/order/${order.id}/pdf`}>
          Download PDF
        </a>
        <a
          className="btn secondary"
          href={`https://wa.me/91${order.customerPhone.replace(/\D/g, "").slice(-10)}`}
          target="_blank"
          rel="noreferrer"
        >
          WhatsApp customer
        </a>
        <button className="btn secondary" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "Update"}
        </button>
      </div>

      {open ? (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          {order.status === "pending" ? (
            <form action={payAction} style={{ marginBottom: 16 }}>
              <input type="hidden" name="orderId" value={order.id} />
              <div className="field">
                <label>Payment reference (UPI txn id or bank reference)</label>
                <input name="paymentRef" required placeholder="e.g. 431298765432" />
              </div>
              {payState?.error ? <div className="notice error">{payState.error}</div> : null}
              <button className="btn" type="submit" disabled={payPending}>
                {payPending ? "Saving..." : "Mark as paid"}
              </button>
            </form>
          ) : null}

          <form action={updateOrderStatusAction}>
            <input type="hidden" name="orderId" value={order.id} />
            <div className="field">
              <label>Status</label>
              <select name="status" defaultValue={order.status}>
                <option value="pending">Awaiting payment</option>
                <option value="paid">Paid</option>
                <option value="packed">Packed</option>
                <option value="dispatched">Dispatched</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            {/* Fireworks travel by licensed road transport, so dispatch is a
                transporter name and an LR number, not a courier tracking id. */}
            <div className="grid-2">
              <div className="field">
                <label>Transport name</label>
                <input
                  name="transportName"
                  defaultValue={order.transportName ?? ""}
                  placeholder="e.g. KPN Travels"
                />
              </div>
              <div className="field">
                <label>LR number</label>
                <input name="transportLrNumber" defaultValue={order.transportLrNumber ?? ""} />
              </div>
            </div>

            <button className="btn" type="submit">
              Save
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
