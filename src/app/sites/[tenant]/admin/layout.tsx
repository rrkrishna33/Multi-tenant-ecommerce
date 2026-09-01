import { redirect } from "next/navigation";
import { getTenantByKey } from "@/lib/tenant-db";
import { requireShopAccess } from "@/lib/session";
import { notFound } from "next/navigation";
import { logoutAction } from "./actions";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: key } = await params;
  const tenant = await getTenantByKey(key);
  if (!tenant) notFound();

  const session = await requireShopAccess(tenant.id);
  if (!session) redirect("/login");

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <h1>{tenant.shopName} · Admin</h1>
          <nav style={{ marginLeft: "auto", display: "flex", gap: 16, alignItems: "center" }}>
            <a href="/admin/orders">Orders</a>
            <a href="/admin/products">Products</a>
            <a href="/admin/settings">Settings</a>
            <a href="/" target="_blank">View shop</a>
            <form action={logoutAction}>
              <button className="btn secondary" type="submit">Sign out</button>
            </form>
          </nav>
        </div>
      </header>
      <main className="wrap" style={{ paddingTop: 24, paddingBottom: 60 }}>{children}</main>
    </>
  );
}
