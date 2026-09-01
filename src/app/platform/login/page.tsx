import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/session";
import { PlatformLoginForm } from "./form";

export default async function PlatformLoginPage() {
  if (await requirePlatformAdmin()) redirect("/platform");
  return (
    <div style={{ maxWidth: 400, margin: "40px auto" }}>
      <h2>Sign in</h2>
      <PlatformLoginForm />
    </div>
  );
}
