import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getDb, withTenant } from "@/db";
import { orders } from "@/db/schema";
import { getTenantByKey } from "@/lib/tenant-db";
import { formatInr } from "@/lib/pricing";
import { formatEstimateNumber } from "@/lib/orders";
import { OrderRow } from "./order-row";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { tenant: key } = await params;
  const { status } = await searchParams;
  const tenant = await getTenantByKey(key);
  if (!tenant) notFound();

  const rows = await withTenant(getDb(), tenant.id, async (tx) => {
    const query = tx.select().from(orders).orderBy(desc(orders.createdAt)).limit(200);
    return status ? query.where(eq(orders.status, status as any)) : query;
  });

  const pendingTotal = rows
    .filter((o: any) => o.status === "pending")
    .reduce((s: number, o: any) => s + o.subtotal, 0);

  return (
    <>
      <h2>Orders</h2>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "12px 0 20px" }}>
        <div className="card" style={{ margin: 0, flex: 1, minWidth: 180 }}>
          <div className="muted">Orders shown</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{rows.length}</div>
        </div>
        <div className="card" style={{ margin: 0, flex: 1, minWidth: 180 }}>
          <div className="muted">Awaiting payment</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{formatInr(pendingTotal)}</div>
        </div>
      </div>

      <nav style={{ marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <a href="/admin/orders">All</a>
        <a href="/admin/orders?status=pending">Awaiting payment</a>
        <a href="/admin/orders?status=paid">Paid</a>
        <a href="/admin/orders?status=dispatched">Dispatched</a>
      </nav>

      {rows.length === 0 ? (
        <div className="notice">No orders yet.</div>
      ) : (
        rows.map((order: any) => (
          <OrderRow
            key={order.id}
            order={{
              id: order.id,
              estimateNumber: formatEstimateNumber(order.orderNumber),
              customerName: order.customerName,
              customerPhone: order.customerPhone,
              city: order.city,
              pincode: order.pincode,
              subtotal: order.subtotal,
              status: order.status,
              paymentRef: order.paymentRef,
              transportName: order.transportName,
              transportLrNumber: order.transportLrNumber,
              createdAt: order.createdAt.toISOString(),
            }}
          />
        ))
      )}
    </>
  );
}
