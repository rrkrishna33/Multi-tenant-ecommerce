"use client";

import { useActionState, useEffect, useState } from "react";
import { createTenantAction, type CreateTenantState } from "../actions";
import { PLANS, planIds } from "@/lib/subscriptions";
import { slugify } from "@/lib/provisioning";
import { formatInr } from "@/lib/pricing";

export function NewTenantForm({ platformDomain }: { platformDomain: string }) {
  const [state, action, pending] = useActionState<CreateTenantState, FormData>(
    createTenantAction,
    {},
  );

  // Full navigation, not a router push: see platformLoginAction.
  useEffect(() => {
    if (state.to) window.location.assign(state.to);
  }, [state.to]);
  const [shopName, setShopName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [plan, setPlan] = useState<string>("standard");
  const [period, setPeriod] = useState("12");

  // Deriving the slug from the shop name is the difference between onboarding
  // a client in one minute and explaining what a subdomain is on the phone.
  const effectiveSlug = slugTouched ? slug : slugify(shopName);
  const selectedPlan = PLANS[plan as keyof typeof PLANS];

  return (
    <form action={action}>
      <h2>Add a shop</h2>
      {state.error ? <div className="notice error">{state.error}</div> : null}
      {state.to ? (
        <div className="notice ok">
          Shop created. <a href={state.to}>Open it</a> if this page does not move
          on its own.
        </div>
      ) : null}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Shop</h3>
        <div className="field">
          <label htmlFor="shopName">Shop name</label>
          <input
            id="shopName"
            name="shopName"
            required
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            placeholder="Anil Crackers"
          />
        </div>

        <div className="field">
          <label htmlFor="slug">Web address</label>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              id="slug"
              name="slug"
              required
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
            />
            <span className="muted" style={{ whiteSpace: "nowrap" }}>
              .{platformDomain}
            </span>
          </div>
          <div className="muted">Works immediately, before any domain is set up.</div>
        </div>

        <div className="field">
          <label htmlFor="phone">Shop phone</label>
          <input id="phone" name="phone" placeholder="9842012345" />
        </div>

        <div className="field">
          <label htmlFor="customDomain">Custom domain (optional)</label>
          <input
            id="customDomain"
            name="customDomain"
            placeholder="anilcrackers.com"
            disabled={!selectedPlan?.customDomain}
          />
          <div className="muted">
            {selectedPlan?.customDomain
              ? "The client points an A record at the server; HTTPS is issued automatically on the first visit."
              : `The ${selectedPlan?.name} plan does not include a custom domain.`}
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Owner login</h3>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="ownerName">Owner name</label>
            <input id="ownerName" name="ownerName" required />
          </div>
          <div className="field">
            <label htmlFor="ownerEmail">Email</label>
            <input id="ownerEmail" name="ownerEmail" type="email" required />
          </div>
        </div>
        <div className="field">
          <label htmlFor="ownerPassword">Temporary password</label>
          <input id="ownerPassword" name="ownerPassword" required minLength={8} />
          <div className="muted">At least 8 characters. Share it with the owner directly.</div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Subscription</h3>
        <div className="field">
          <label htmlFor="plan">Plan</label>
          <select id="plan" name="plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
            {planIds.map((id) => (
              <option key={id} value={id}>
                {PLANS[id].name} — {formatInr(PLANS[id].monthlyPrice)}/month
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="periodMonths">Billing</label>
          <select
            id="periodMonths"
            name="periodMonths"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            <option value="1">Monthly</option>
            <option value="12">Yearly (2 months free)</option>
          </select>
        </div>

        {selectedPlan ? (
          <p>
            Charge now:{" "}
            <strong>
              {formatInr(
                period === "12" ? selectedPlan.yearlyPrice : selectedPlan.monthlyPrice,
              )}
            </strong>
            <span className="muted">
              {" "}
              · {selectedPlan.maxProducts ?? "Unlimited"} products
            </span>
          </p>
        ) : null}
      </div>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Creating..." : "Create shop"}
      </button>
    </form>
  );
}
