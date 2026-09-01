import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { resolveUploadPath, CONTENT_TYPES } from "@/lib/uploads";

export const runtime = "nodejs";

/**
 * Serves uploaded product images.
 *
 * In production Caddy serves /uploads/* straight from disk and this handler is
 * never reached -- see deploy/Caddyfile. It exists so development works without
 * a reverse proxy, and as a fallback if the Caddy rule is ever removed.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;

  const resolved = resolveUploadPath(path);
  if (!resolved.ok) {
    return new NextResponse("Not found", { status: 404 });
  }

  let size: number;
  try {
    const info = await stat(resolved.absolutePath);
    if (!info.isFile()) return new NextResponse("Not found", { status: 404 });
    size = info.size;
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const stream = Readable.toWeb(
    createReadStream(resolved.absolutePath),
  ) as unknown as ReadableStream;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": CONTENT_TYPES[resolved.extension] ?? "application/octet-stream",
      "Content-Length": String(size),
      // Filenames are content-addressed by a random UUID and never reused, so
      // a replaced image gets a new URL and this can be cached hard.
      "Cache-Control": "public, max-age=31536000, immutable",
      // Defence in depth: even if a non-image somehow lands here, the browser
      // must not be talked into interpreting it.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
