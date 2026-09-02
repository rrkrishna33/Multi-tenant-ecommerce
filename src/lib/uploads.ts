import { randomUUID } from "node:crypto";
import { join, normalize, sep } from "node:path";
import { env } from "./env";

/**
 * Product image uploads.
 *
 * Files live on the VPS disk under a per-tenant directory and are served
 * straight by Caddy in production, so Node never touches them on the read path
 * -- which matters when a Diwali storefront is serving a few hundred thumbnails
 * a second.
 */

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB

export type ImageKind = "jpeg" | "png" | "webp" | "gif";

const EXTENSIONS: Record<ImageKind, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  gif: "gif",
};

export const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * Identifies an image by its magic bytes rather than its filename or the
 * browser-supplied Content-Type, both of which the client controls.
 *
 * SVG is deliberately unsupported: it is XML that can carry script, and serving
 * one from our own origin would hand a shop owner stored XSS against their own
 * customers.
 */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => bytes[i] === b)) return "png";

  // GIF: "GIF87a" / "GIF89a"
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "gif";
  }

  // WEBP: "RIFF" .... "WEBP"
  const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (riff && webp) return "webp";

  return null;
}

export type ValidationResult =
  | { ok: true; kind: ImageKind; extension: string }
  | { ok: false; message: string };

export function validateImage(bytes: Uint8Array, declaredSize?: number): ValidationResult {
  const size = declaredSize ?? bytes.length;

  if (size === 0) return { ok: false, message: "That file is empty." };
  if (size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      message: `Images must be under ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))} MB. Please compress it and try again.`,
    };
  }

  const kind = sniffImage(bytes);
  if (!kind) {
    return {
      ok: false,
      message: "That is not a supported image. Use a JPG, PNG, WEBP or GIF photo.",
    };
  }

  return { ok: true, kind, extension: EXTENSIONS[kind] };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILENAME_RE = /^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/i;

/** Relative storage path for a newly uploaded image. */
export function buildImagePath(tenantId: string, extension: string): string {
  if (!UUID_RE.test(tenantId)) {
    throw new Error("buildImagePath requires a UUID tenant id");
  }
  // The filename is random, never derived from the uploaded name. A
  // client-supplied name is an attacker-supplied name.
  return `${tenantId}/${randomUUID()}.${extension}`;
}

export function publicUrlFor(relativePath: string): string {
  return `/uploads/${relativePath}`;
}

export function uploadRoot(): string {
  return env("UPLOAD_DIR") ?? join(process.cwd(), "var", "uploads");
}

export type ResolvedPath =
  | { ok: true; absolutePath: string; extension: string }
  | { ok: false };

/**
 * Resolves a request path to a file on disk.
 *
 * Every segment is validated against a strict pattern and the final path is
 * confirmed to sit inside the upload root. Path traversal here would let a
 * request walk out of the uploads directory and read .env -- the session
 * secret and both database passwords.
 */
export function resolveUploadPath(segments: string[]): ResolvedPath {
  if (segments.length !== 2) return { ok: false };

  const [tenantId, filename] = segments;
  if (!UUID_RE.test(tenantId)) return { ok: false };
  if (!FILENAME_RE.test(filename)) return { ok: false };

  const root = uploadRoot();
  const candidate = normalize(join(root, tenantId, filename));

  // Belt and braces: even with the patterns above, confirm containment.
  const rootWithSep = normalize(root).endsWith(sep) ? normalize(root) : normalize(root) + sep;
  if (!candidate.startsWith(rootWithSep)) return { ok: false };

  const extension = filename.split(".").pop()!.toLowerCase();
  return { ok: true, absolutePath: candidate, extension };
}

/** Extracts the stored relative path from a public URL, for deletion. */
export function relativePathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const match = /^\/uploads\/([0-9a-f-]{36})\/([0-9a-f-]{36}\.(?:jpg|png|webp|gif))$/i.exec(url);
  return match ? `${match[1]}/${match[2]}` : null;
}
