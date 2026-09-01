import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import {
  sniffImage,
  validateImage,
  buildImagePath,
  publicUrlFor,
  resolveUploadPath,
  relativePathFromUrl,
  MAX_IMAGE_BYTES,
} from "../src/lib/uploads";

const TENANT = "11111111-1111-1111-1111-111111111111";

beforeAll(() => {
  process.env.UPLOAD_DIR = join(process.cwd(), "var", "uploads");
});

const bytes = (...values: number[]) => Uint8Array.from(values);
const pad = (head: number[], length = 32) =>
  Uint8Array.from([...head, ...Array(Math.max(0, length - head.length)).fill(0)]);

const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF87 = pad([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
const GIF89 = pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = pad([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

describe("sniffImage", () => {
  it("identifies the supported formats by magic bytes", () => {
    expect(sniffImage(JPEG)).toBe("jpeg");
    expect(sniffImage(PNG)).toBe("png");
    expect(sniffImage(GIF87)).toBe("gif");
    expect(sniffImage(GIF89)).toBe("gif");
    expect(sniffImage(WEBP)).toBe("webp");
  });

  it("rejects SVG, which is scriptable XML rather than an image", () => {
    // Serving this from our own origin would be stored XSS against the
    // shop's own customers.
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(sniffImage(svg)).toBeNull();
  });

  it("rejects a script or executable renamed to .jpg", () => {
    expect(sniffImage(new TextEncoder().encode("<?php system($_GET[0]); ?>"))).toBeNull();
    expect(sniffImage(pad([0x4d, 0x5a]))).toBeNull(); // MZ, a Windows exe
    expect(sniffImage(pad([0x7f, 0x45, 0x4c, 0x46]))).toBeNull(); // ELF
    expect(sniffImage(new TextEncoder().encode("#!/bin/sh\nrm -rf /"))).toBeNull();
  });

  it("rejects a RIFF container that is not WEBP", () => {
    // A .wav is also RIFF; only RIFF....WEBP counts.
    const wav = pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    expect(sniffImage(wav)).toBeNull();
  });

  it("rejects input too short to identify", () => {
    expect(sniffImage(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffImage(new Uint8Array(0))).toBeNull();
  });
});

describe("validateImage", () => {
  it("accepts a valid image and reports its extension", () => {
    const result = validateImage(JPEG);
    expect(result).toEqual({ ok: true, kind: "jpeg", extension: "jpg" });
    expect(validateImage(PNG)).toMatchObject({ extension: "png" });
  });

  it("rejects an empty file", () => {
    const r = validateImage(new Uint8Array(0));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("empty");
  });

  it("rejects a file over the size limit before reading it", () => {
    const r = validateImage(JPEG, MAX_IMAGE_BYTES + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("3 MB");
  });

  it("accepts a file exactly at the limit", () => {
    expect(validateImage(JPEG, MAX_IMAGE_BYTES).ok).toBe(true);
  });

  it("gives a shop owner a message they can act on", () => {
    const r = validateImage(new TextEncoder().encode("not an image at all"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/JPG, PNG, WEBP or GIF/);
  });
});

describe("buildImagePath", () => {
  it("scopes the file under the tenant and randomises the name", () => {
    const a = buildImagePath(TENANT, "jpg");
    const b = buildImagePath(TENANT, "jpg");
    expect(a.startsWith(`${TENANT}/`)).toBe(true);
    expect(a).not.toBe(b); // never collide, never reuse a client-supplied name
    expect(a.endsWith(".jpg")).toBe(true);
  });

  it("refuses a non-UUID tenant id", () => {
    expect(() => buildImagePath("../../etc", "jpg")).toThrow(/UUID/);
  });

  it("builds a public URL under /uploads", () => {
    expect(publicUrlFor(`${TENANT}/abc.jpg`)).toBe(`/uploads/${TENANT}/abc.jpg`);
  });
});

describe("resolveUploadPath", () => {
  const file = "22222222-2222-2222-2222-222222222222.jpg";

  it("resolves a well-formed path inside the upload root", () => {
    const r = resolveUploadPath([TENANT, file]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.absolutePath).toContain("uploads");
      expect(r.extension).toBe("jpg");
    }
  });

  it("refuses path traversal in either segment", () => {
    // Escaping the uploads directory would expose .env -- the session secret
    // and both database passwords.
    expect(resolveUploadPath(["..", "..", ".env"]).ok).toBe(false);
    expect(resolveUploadPath([TENANT, "../../../.env"]).ok).toBe(false);
    expect(resolveUploadPath(["../" + TENANT, file]).ok).toBe(false);
    expect(resolveUploadPath([TENANT, "..%2f..%2f.env"]).ok).toBe(false);
    expect(resolveUploadPath([TENANT + "/..", file]).ok).toBe(false);
  });

  it("refuses absolute paths and null bytes", () => {
    expect(resolveUploadPath(["/etc", "passwd"]).ok).toBe(false);
    expect(resolveUploadPath([TENANT, "abc.jpg\u0000.txt"]).ok).toBe(false);
    expect(resolveUploadPath(["C:\\Windows", "win.ini"]).ok).toBe(false);
  });

  it("refuses the wrong number of segments", () => {
    expect(resolveUploadPath([]).ok).toBe(false);
    expect(resolveUploadPath([TENANT]).ok).toBe(false);
    expect(resolveUploadPath([TENANT, "sub", file]).ok).toBe(false);
  });

  it("refuses a non-image extension even under a valid tenant", () => {
    for (const bad of ["evil.php", "evil.svg", "evil.html", "evil.js", "evil"]) {
      expect(resolveUploadPath([TENANT, bad]).ok).toBe(false);
    }
  });

  it("refuses a filename that is not the generated UUID form", () => {
    expect(resolveUploadPath([TENANT, "photo.jpg"]).ok).toBe(false);
  });
});

describe("relativePathFromUrl", () => {
  const url = `/uploads/${TENANT}/22222222-2222-2222-2222-222222222222.png`;

  it("round-trips a stored URL", () => {
    expect(relativePathFromUrl(url)).toBe(
      `${TENANT}/22222222-2222-2222-2222-222222222222.png`,
    );
  });

  it("returns null for anything else", () => {
    expect(relativePathFromUrl(null)).toBeNull();
    expect(relativePathFromUrl("https://example.com/x.png")).toBeNull();
    expect(relativePathFromUrl("/uploads/../../.env")).toBeNull();
    expect(relativePathFromUrl("/uploads/x/y.php")).toBeNull();
  });
});
