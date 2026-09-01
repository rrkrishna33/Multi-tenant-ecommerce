import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/session";
import { listTenants } from "@/lib/platform-service";
import { formatInr } from "@/lib/pricing";
import { PLANS, daysUntil, isPlanId, planName } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

export default async function PlatformHome({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  if (!(await requirePlatformAdmin())) redirect("/platform/login");

  const { created } = await searchParams;
  const shops = await listTenants();
  const now = new Date();

  const mrr = shops
    .filter((s) => s.status === "active" || s.status === "trial")
    .reduce((sum, s) => {
      if (!s.plan || !isPlanId(s.plan)) return sum;
      return sum + PLANS[s.plan].monthlyPrice;
    }, 0);

  const gmv = shops.reduce((sum, s) => sum + s.revenue, 0);

  return (
    <>
      {created ? (
        <div className="notice ok">
          Shop <strong>{created}</strong> created. It is live now at{" "}
          <code>
            {created}.{process.env.PLATFORM_DOMAIN ?? "localhost:3000"}
          </code>
          .
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <Stat label="Shops" value={String(shops.length)} />
        <Stat
          label="Active"
          value={String(shops.filter((s) => s.status === "active").length)}
        />
        <Stat label="Monthly recurring" value={formatInr(mrr)} />
        <Stat label="Orders placed (all shops)" value={formatInr(gmv)} />
      </div>

      <h2>Shops</h2>

      {shops.length === 0 ? (
        <div className="notice">
          No shops yet. <a href="/platform/new">Add your first client</a>.
        </div>
      ) : (
        <table className="order-table">
          <thead>
            <tr>
              <th>Shop</th>
              <th>Address</th>
              <th>Plan</th>
              <th>Renews</th>
              <th className="num">Products</th>
              <th className="num">Orders</th>
              <th className="num">Value</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shops.map((s) => {
              const days = s.expiresAt ? daysUntil(new Date(s.expiresAt), now) : null;
              return (
                <tr key={s.id}>
                  <td>
                    <a href={`/platform/${s.id}`}>
                      <strong>{s.shopName}</strong>
                    </a>
                  </td>
                  <td className="muted">
                    {s.customDomain ?? `${s.slug}.${process.env.PLATFORM_DOMAIN ?? ""}`}
                  </td>
                  <td>{s.plan ? planName(s.plan) : "-"}</td>
                  <td className={days !== null && days <= 7 ? "" : "muted"}>
                    {s.expiresAt
                      ? `${new Date(s.expiresAt).toLocaleDateString("en-IN")}${
                          days !== null && days <= 14
                            ? ` (${days < 0 ? `${-days}d overdue` : `${days}d`})`
                            : ""
                        }`
                      : "-"}
                  </td>
                  <td className="num">{s.productCount}</td>
                  <td className="num">{s.orderCount}</td>
                  <td className="num">{formatInr(s.revenue)}</td>
                  <td>
                    <span className={`badge ${s.status === "active" ? "paid" : "pending"}`}>
                      {s.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ margin: 0, flex: 1, minWidth: 170 }}>
      <div className="muted">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
