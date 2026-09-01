import { NextResponse, type NextRequest } from "next/server";
import { normalizeHost, parsePlatformSubdomain } from "./lib/tenant";

/**
 * Host-based routing.
 *
 * Deliberately does NO database work. Middleware runs on the Edge runtime,
 * where node-postgres cannot be used, and putting a DB round trip in front of
 * every asset request would be the wrong shape anyway. This only decides which
 * part of the app the request belongs to; the tenant is resolved inside the
 * page, on the Node runtime, where it can be cached.
 */
export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const rawHost = req.headers.get("host") ?? "";
  const host = normalizeHost(rawHost);
  const platformDomain = normalizeHost(process.env.PLATFORM_DOMAIN ?? "localhost:3000");

  if (!host) {
    return new NextResponse("Missing Host header", { status: 400 });
  }

  // /sites/* is the internal rewrite target. A request that arrives already
  // pointing at it is either a probe or a mistake -- serving it would let a
  // visitor on one shop's domain address another shop's pages directly.
  if (url.pathname === "/sites" || url.pathname.startsWith("/sites/")) {
    return new NextResponse("Not found", { status: 404 });
  }

  const isPlatformApex = host === platformDomain || host === `www.${platformDomain}`;

  // The platform's own site: marketing pages, tenant sign-in, platform admin.
  if (isPlatformApex) {
    return NextResponse.next();
  }

  // A tenant subdomain, or a client's custom domain. Everything below the root
  // path belongs to that shop's storefront and its own admin.
  const slug = parsePlatformSubdomain(host, platformDomain);
  const tenantKey = slug ?? host;

  const rewritten = new URL(url);
  rewritten.pathname = `/sites/${encodeURIComponent(tenantKey)}${url.pathname}`;

  // The rewrite hides the customer-facing path from the layout, which needs it
  // to tell a storefront page from the shop's own admin -- the owner should not
  // be interrupted by their own notice popup while editing it.
  const headers = new Headers(req.headers);
  headers.set("x-shop-path", url.pathname);

  return NextResponse.rewrite(rewritten, { request: { headers } });
}

export const config = {
  matcher: [
    /**
     * Everything except Next internals, the internal API used by Caddy, and
     * static files. `_next/image` is excluded too: rewriting it would make
     * every product thumbnail resolve against the tenant path.
     */
    "/((?!_next/static|_next/image|api/internal|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff2?)$).*)",
  ],
};
