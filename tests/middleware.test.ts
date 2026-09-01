import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";

beforeAll(() => {
  process.env.PLATFORM_DOMAIN = "crackerskart.com";
});

function request(host: string, path = "/") {
  return new NextRequest(new URL(`https://${host}${path}`), {
    headers: { host },
  });
}

/** The rewritten path Next will actually render, or null when not rewritten. */
function rewriteTarget(res: Response): string | null {
  const dest = res.headers.get("x-middleware-rewrite");
  return dest ? new URL(dest).pathname : null;
}

describe("host-based routing middleware", () => {
  it("passes the platform apex straight through", () => {
    const res = middleware(request("crackerskart.com", "/"));
    expect(rewriteTarget(res)).toBeNull();
    expect(res.status).toBe(200);
  });

  it("passes www of the platform through", () => {
    expect(rewriteTarget(middleware(request("www.crackerskart.com")))).toBeNull();
  });

  it("rewrites a tenant subdomain to its storefront", () => {
    const res = middleware(request("anil-crackers.crackerskart.com", "/"));
    expect(rewriteTarget(res)).toBe("/sites/anil-crackers/");
  });

  it("rewrites a custom domain using the full host as the key", () => {
    const res = middleware(request("anilcrackers.com", "/"));
    expect(rewriteTarget(res)).toBe("/sites/anilcrackers.com/");
  });

  it("preserves the rest of the path", () => {
    const res = middleware(request("anilcrackers.com", "/admin/orders"));
    expect(rewriteTarget(res)).toBe("/sites/anilcrackers.com/admin/orders");
  });

  it("passes the customer-facing path on to the layout", () => {
    // The rewrite hides the real path, and the layout needs it to keep the
    // notice popup off the shop's own admin pages.
    const res = middleware(request("anilcrackers.com", "/admin/settings"));
    const forwarded = res.headers.get("x-middleware-override-headers") ?? "";
    expect(forwarded).toContain("x-shop-path");
    expect(res.headers.get("x-middleware-request-x-shop-path")).toBe("/admin/settings");
  });

  it("preserves the query string", () => {
    const res = middleware(request("anilcrackers.com", "/admin/orders?status=paid"));
    const dest = new URL(res.headers.get("x-middleware-rewrite")!);
    expect(dest.pathname).toBe("/sites/anilcrackers.com/admin/orders");
    expect(dest.searchParams.get("status")).toBe("paid");
  });

  it("treats a reserved subdomain as a host key rather than a tenant slug", () => {
    // admin.crackerskart.com is not a shop, so it must not resolve as slug
    // "admin" -- it falls through to a domain lookup that will find nothing.
    const res = middleware(request("admin.crackerskart.com", "/"));
    expect(rewriteTarget(res)).toBe("/sites/admin.crackerskart.com/");
  });

  it("404s a request that already targets the internal rewrite path", () => {
    // Without this, a visitor on one shop's domain could address another
    // shop's pages directly via /sites/<other>.
    const res = middleware(request("anilcrackers.com", "/sites/murugan-fireworks"));
    expect(res.status).toBe(404);
  });

  it("rejects a request with no Host header", () => {
    const req = new NextRequest(new URL("https://example.com/"), { headers: {} });
    req.headers.delete("host");
    const res = middleware(req);
    expect(res.status).toBe(400);
  });

  it("ignores a port on the Host header", () => {
    const res = middleware(request("anilcrackers.com:3000", "/"));
    expect(rewriteTarget(res)).toBe("/sites/anilcrackers.com/");
  });

  it("does not treat a lookalike domain as a platform subdomain", () => {
    const res = middleware(request("shop.evilcrackerskart.com", "/"));
    expect(rewriteTarget(res)).toBe("/sites/shop.evilcrackerskart.com/");
  });
});
