import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/session";
import { NewTenantForm } from "./form";

export default async function NewTenantPage() {
  if (!(await requirePlatformAdmin())) redirect("/platform/login");
  return <NewTenantForm platformDomain={process.env.PLATFORM_DOMAIN ?? "localhost:3000"} />;
}
