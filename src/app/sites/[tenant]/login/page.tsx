import { notFound } from "next/navigation";
import { getTenantByKey } from "@/lib/tenant-db";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: key } = await params;
  const tenant = await getTenantByKey(key);
  if (!tenant) notFound();

  return (
    <main className="wrap" style={{ maxWidth: 420, paddingTop: 60 }}>
      <h1>{tenant.shopName}</h1>
      <p className="muted">Sign in to manage your catalogue and orders.</p>
      <LoginForm />
    </main>
  );
}
