import { NextResponse, type NextRequest } from "next/server";
import { dbLookup } from "@/lib/tenant-db";
import { normalizeHost } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Caddy's on-demand TLS `ask` endpoint.
 *
 * Before issuing a Let's Encrypt certificate for an unfamiliar domain, Caddy
 * calls this. A 200 authorises issuance; anything else refuses it.
 *
 * This check is not optional. Without it, anyone who points a DNS record at
 * this server's IP makes us request a certificate on their behalf -- burning
 * the Let's Encrypt rate limit (50 certs per registered domain per week) and
 * turning the VPS into an open certificate mill.
 *
 * Caddy must be configured to call this on localhost so it is never reachable
 * from the internet.
 */
export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) {
    return new NextResponse("missing domain", { status: 400 });
  }

  const host = normalizeHost(domain);

  // Always allow the platform's own hostnames.
  const platformDomain = normalizeHost(process.env.PLATFORM_DOMAIN ?? "");
  if (platformDomain && (host === platformDomain || host.endsWith(`.${platformDomain}`))) {
    return new NextResponse("ok", { status: 200 });
  }

  const tenant =
    (await dbLookup.byCustomDomain(host)) ??
    (host.startsWith("www.")
      ? await dbLookup.byCustomDomain(host.slice(4))
      : await dbLookup.byCustomDomain(`www.${host}`));

  if (!tenant) {
    return new NextResponse("unknown domain", { status: 404 });
  }

  // Note that a suspended shop still gets a certificate. Whether we serve its
  // storefront is a separate decision, made in the page. Pulling HTTPS for a
  // late subscription payment would break the domain far more rudely than the
  // "subscription expired" notice the storefront shows -- and would leave the
  // client with a browser security warning on a domain they own.
  return new NextResponse("ok", { status: 200 });
}
