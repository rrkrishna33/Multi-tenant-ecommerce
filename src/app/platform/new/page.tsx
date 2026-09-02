import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/session";
import { NewTenantForm } from "./form";
import { envOr } from "@/lib/env";

export default async function NewTenantPage() {
  if (!(await requirePlatformAdmin())) redirect("/platform/login");
  return <NewTenantForm platformDomain={envOr("PLATFORM_DOMAIN", "localhost:3000")} />;
}
