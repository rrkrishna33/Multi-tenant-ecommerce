import type { NextConfig } from "next";

/**
 * Dev and production builds use SEPARATE output directories.
 *
 * Sharing one `.next` between `next build` and `next dev` is a real trap: the
 * dev server ends up reading artifacts a production build is rewriting
 * underneath it, and the symptoms are baffling -- 404s on pages that plainly
 * exist, or `Cannot find module './123.js'`. Splitting them means
 * `npm run build` and `npm run dev` can never interfere, in either order.
 *
 * NEXT_DIST_DIR overrides both, for running a second build alongside a live
 * server.
 *
 * Read with `||`, not `??`: a `.env` copied from .env.example carries
 * `NEXT_DIST_DIR=`, and the empty string is a *set* value as far as `??` is
 * concerned. That produced `distDir: ""` and a build that failed on a fresh VPS
 * with an error naming neither the variable nor the file it came from. This
 * config cannot import from src/, so it repeats what lib/env.ts does for the
 * rest of the app.
 */
const distDir =
  process.env.NEXT_DIST_DIR?.trim() ||
  (process.env.NODE_ENV === "development" ? ".next-dev" : ".next");

const nextConfig: NextConfig = {
  distDir,

  /**
   * Server Actions are posted from whatever domain the shop is served on, and
   * every tenant has a different one. Next compares the request Origin against
   * the forwarded host; Caddy passes the original Host through, so same-origin
   * submissions pass on their own.
   *
   * SERVER_ACTION_ORIGINS is for the case where something in front rewrites the
   * host (a CDN, a tunnel), as a comma-separated list of hostnames.
   */
  experimental: {
    serverActions: {
      allowedOrigins: (process.env.SERVER_ACTION_ORIGINS ?? "")
        .trim()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      bodySizeLimit: "6mb", // CSV price lists and product photos
    },
  },
};

export default nextConfig;
