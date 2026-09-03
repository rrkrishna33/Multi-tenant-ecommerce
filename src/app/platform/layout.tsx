import { requirePlatformAdmin } from "@/lib/session";
import { platformLogoutAction } from "./actions";
import { SignOutButton } from "../sign-out-button";

/**
 * Chrome only. Authorisation is enforced in each page, not here: the login
 * page is nested under this route and must render unguarded, and there is no
 * dependable way for a layout to know which child is rendering. A layout that
 * guesses would either lock out the login page or leave a page unguarded.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePlatformAdmin();

  return (
    <>
      <header className="site-header" style={{ background: "#1f2937" }}>
        <div className="wrap">
          <h1>
            <a href="/platform" style={{ textDecoration: "none" }}>
              Platform Admin
            </a>
          </h1>
          {session ? (
            <nav style={{ marginLeft: "auto", display: "flex", gap: 16, alignItems: "center" }}>
              <a href="/platform">Shops</a>
              <a href="/platform/new">Add shop</a>
              <SignOutButton action={platformLogoutAction} to="/platform/login" />
            </nav>
          ) : null}
        </div>
      </header>
      <main className="wrap" style={{ paddingTop: 24, paddingBottom: 60 }}>
        {children}
      </main>
    </>
  );
}
