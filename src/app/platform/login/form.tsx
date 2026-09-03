"use client";

import { useActionState, useEffect } from "react";
import { platformLoginAction, type LoginState } from "../actions";

export function PlatformLoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(platformLoginAction, {});

  // A full navigation rather than a router push: the session cookie was just
  // set, so this starts the signed-in session cleanly instead of leaving the
  // client router holding pre-login renders.
  useEffect(() => {
    if (state?.to) window.location.assign(state.to);
  }, [state?.to]);

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
      <button className="btn" type="submit" disabled={pending || Boolean(state?.to)}>
        {pending ? "Signing in..." : state?.to ? "Signing you in..." : "Sign in"}
      </button>

      {/* Rendered by the action's own response, so sign-in still completes if
          the navigation above never runs -- with JavaScript off, this link is
          the whole flow. */}
      {state?.to ? (
        <p className="muted" style={{ marginTop: 10 }}>
          Signed in. <a href={state.to}>Continue</a> if this page does not move on
          its own.
        </p>
      ) : null}
    </form>
  );
}
