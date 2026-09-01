"use client";

import { useActionState } from "react";
import { platformLoginAction } from "../actions";

export function PlatformLoginForm() {
  const [state, action, pending] = useActionState(
    platformLoginAction,
    {} as { error?: string },
  );

  return (
    <form action={action} className="card">
      {state?.error ? <div className="notice error">{state.error}</div> : null}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="username" />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
