"use client";

import { useTransition } from "react";

/**
 * Sign out, then navigate the browser rather than the client router.
 *
 * Same reason as the sign-in forms and checkout: a `redirect()` out of a server
 * action is followed by the client router, and under this app's host rewrites
 * that intermittently renders "page not found" on a page that loads fine on
 * refresh.
 *
 * Signing out has the extra requirement that nothing signed-in may survive it.
 * `window.location.replace` throws away every cached client render along with
 * the session cookie the action just cleared -- and `replace`, not `assign`, so
 * Back cannot return to a page rendered while the user was still signed in.
 */
export function SignOutButton({ action, to }: { action: () => Promise<void>; to: string }) {
  const [pending, start] = useTransition();

  return (
    <button
      className="btn secondary"
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await action();
          window.location.replace(to);
        })
      }
    >
      {pending ? "Signing out..." : "Sign out"}
    </button>
  );
}
