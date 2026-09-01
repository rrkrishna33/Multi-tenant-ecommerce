"use client";

import { useActionState } from "react";
import { updateDomainAction } from "../actions";

export function DomainForm({
  tenantId,
  currentDomain,
}: {
  tenantId: string;
  currentDomain: string | null;
}) {
  const [state, action, pending] = useActionState(
    updateDomainAction,
    {} as { error?: string },
  );

  return (
    <form action={action}>
      <input type="hidden" name="tenantId" value={tenantId} />
      {state?.error ? <div className="notice error">{state.error}</div> : null}
      <div className="field">
        <label htmlFor="customDomain">Custom domain</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            id="customDomain"
            name="customDomain"
            defaultValue={currentDomain ?? ""}
            placeholder="anilcrackers.com"
          />
          <button className="btn secondary" type="submit" disabled={pending}>
            {pending ? "Saving..." : "Save"}
          </button>
        </div>
        <div className="muted">Leave blank to remove. Paste the domain only, no https://</div>
      </div>
    </form>
  );
}
