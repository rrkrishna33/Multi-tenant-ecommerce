import { notFound, redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/session";
import {
  getTenant,
  getTenantSubscriptions,
  getTenantUsers,
} from "@/lib/platform-service";
import { formatInr } from "@/lib/pricing";
import { PLANS, planName, daysUntil, GRACE_PERIOD_DAYS } from "@/lib/subscriptions";
import { dnsInstructions } from "@/lib/provisioning";
import { setStatusAction, renewAction } from "../actions";
import { DomainForm } from "./domain-form";
import { envOr } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  if (!(await requirePlatformAdmin())) redirect("/platform/login");

  const { tenantId } = await params;
  const shop = await getTenant(tenantId);
  if (!shop) notFound();

  const [subs, staff] = await Promise.all([
    getTenantSubscriptions(tenantId),
    getTenantUsers(tenantId),
  ]);

  const platformDomain = envOr("PLATFORM_DOMAIN", "localhost:3000");
  const serverIp = envOr("SERVER_IP", "<your VPS IP>");
  const current = subs.find((s: any) => !s.cancelledAt) ?? null;
  const days = current ? daysUntil(new Date(current.expiresAt), new Date()) : null;

  return (
    <>
      <p className="muted">
        <a href="/platform">← All shops</a>
      </p>
      <h2>{shop.shopName}</h2>
      <p>
        <span className={`badge ${shop.status === "active" ? "paid" : "pending"}`}>
          {shop.status}
        </span>{" "}
        <span className="muted">
          created {new Date(shop.createdAt).toLocaleDateString("en-IN")}
        </span>
      </p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Addresses</h3>
        <p>
          Platform address:{" "}
          <a href={`https://${shop.slug}.${platformDomain}`} target="_blank" rel="noreferrer">
            {shop.slug}.{platformDomain}
          </a>
          <br />
          <span className="muted">Always works, needs no DNS setup.</span>
        </p>

        <DomainForm tenantId={shop.id} currentDomain={shop.customDomain} />

        {!shop.customDomain ? (
          <>
            <h4>Send the client these DNS records</h4>
            <p className="muted">
              At their domain registrar. Once saved, HTTPS is issued automatically on
              the first visit — nothing to do on our side.
            </p>
            <table className="order-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {dnsInstructions(serverIp).map((r) => (
                  <tr key={r.name}>
                    <td>{r.type}</td>
                    <td>
                      <code>{r.name}</code>
                    </td>
                    <td>
                      <code>{r.value}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Subscription</h3>
        {current ? (
          <p>
            <strong>{planName(current.plan)}</strong>{" "}
            · {formatInr(current.amount)} per {current.periodMonths === 12 ? "year" : "month"}
            <br />
            Renews {new Date(current.expiresAt).toLocaleDateString("en-IN")}
            {days !== null ? (
              <span className={days < 0 ? "" : "muted"}>
                {" "}
                ({days < 0 ? `${-days} days overdue` : `in ${days} days`})
              </span>
            ) : null}
          </p>
        ) : (
          <p className="muted">No subscription on record.</p>
        )}

        {shop.status === "past_due" ? (
          <div className="notice">
            Inside the {GRACE_PERIOD_DAYS}-day grace period — the storefront is still
            serving. Chase the payment rather than suspending: taking a shop offline
            during the Diwali weeks costs them their year.
          </div>
        ) : null}

        <form action={renewAction} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <input type="hidden" name="tenantId" value={shop.id} />
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Plan</label>
            <select name="plan" defaultValue={current?.plan ?? "standard"}>
              {Object.values(PLANS).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Period</label>
            <select name="periodMonths" defaultValue={String(current?.periodMonths ?? 1)}>
              <option value="1">Monthly</option>
              <option value="12">Yearly</option>
            </select>
          </div>
          <button className="btn" type="submit">
            Record payment &amp; extend
          </button>
        </form>
        <p className="muted" style={{ marginTop: 8 }}>
          Extends from the current expiry, so paying early never loses days.
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Status</h3>
        <form action={setStatusAction} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <input type="hidden" name="tenantId" value={shop.id} />
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Set status</label>
            <select name="status" defaultValue={shop.status}>
              <option value="trial">Trial</option>
              <option value="active">Active</option>
              <option value="past_due">Past due</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
          <button className="btn secondary" type="submit">
            Save
          </button>
        </form>
        <p className="muted" style={{ marginTop: 8 }}>
          Suspended shops show an "unavailable" page instead of the storefront. Their
          certificate keeps renewing, so the domain never shows a browser security
          warning.
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Logins</h3>
        <table className="order-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((u: any) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Billing history</h3>
        <table className="order-table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Period</th>
              <th>From</th>
              <th>To</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {subs.map((s: any) => (
              <tr key={s.id}>
                <td>{planName(s.plan)}</td>
                <td>{s.periodMonths === 12 ? "Yearly" : "Monthly"}</td>
                <td>{new Date(s.startedAt).toLocaleDateString("en-IN")}</td>
                <td>{new Date(s.expiresAt).toLocaleDateString("en-IN")}</td>
                <td className="num">{formatInr(s.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
