"use client";

import { useActionState } from "react";
import { importProductsAction, type ImportState } from "../actions";

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(
    importProductsAction,
    {},
  );

  return (
    <form action={action} className="card">
      <h3 style={{ marginTop: 0 }}>Upload your price list</h3>
      <p className="muted">
        Export your Excel price list as CSV. Columns can be named Name/Product,
        MRP/Rate, Discount, Category, Unit, Pieces and Code. Rows with a matching
        Code are updated rather than duplicated.
      </p>

      {state.error ? <div className="notice error">{state.error}</div> : null}

      {state.imported ? (
        <div className="notice ok">
          Imported {state.imported} product{state.imported === 1 ? "" : "s"}.
          {state.issues?.length
            ? ` ${state.issues.length} row${state.issues.length === 1 ? "" : "s"} skipped.`
            : ""}
        </div>
      ) : null}

      {state.issues?.length ? (
        <details style={{ marginBottom: 12 }}>
          <summary>Skipped rows ({state.issues.length})</summary>
          <ul className="muted">
            {state.issues.slice(0, 50).map((issue, i) => (
              <li key={i}>
                Line {issue.line}: {issue.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="field">
        <label htmlFor="file">CSV file</label>
        <input id="file" name="file" type="file" accept=".csv,text/csv" required />
      </div>

      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input type="checkbox" name="replace" />
        <span>
          Hide all existing products first
          <span className="muted"> (use when uploading a whole new season price list)</span>
        </span>
      </label>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Importing..." : "Import products"}
      </button>
    </form>
  );
}
