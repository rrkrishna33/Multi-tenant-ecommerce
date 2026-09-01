import { describe, it, expect, beforeAll } from "vitest";
import {
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  type SessionPayload,
} from "../src/lib/auth";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-that-is-long-enough-to-pass-32";
});

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("wrong password here", hash)).toBe(false);
  });

  it("salts each hash, so identical passwords differ", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });

  it("refuses a short password at hashing time", async () => {
    await expect(hashPassword("short")).rejects.toThrow(/at least 8/);
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    for (const bad of ["", "garbage", "scrypt$onlytwo", "bcrypt$salt$hash", "scrypt$salt$zz"]) {
      expect(await verifyPassword("anything", bad)).toBe(false);
    }
  });
});

describe("session tokens", () => {
  const payload = (over: Partial<SessionPayload> = {}): SessionPayload => ({
    userId: "11111111-1111-1111-1111-111111111111",
    tenantId: "22222222-2222-2222-2222-222222222222",
    role: "shop_owner",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...over,
  });

  it("round-trips a valid session", () => {
    const token = signSession(payload());
    const decoded = verifySession(token);
    expect(decoded?.userId).toBe(payload().userId);
    expect(decoded?.role).toBe("shop_owner");
  });

  it("rejects a tampered payload", () => {
    const token = signSession(payload());
    const [body, sig] = token.split(".");
    // Re-encode the payload with escalated privileges, keeping the old signature.
    const forged = Buffer.from(
      JSON.stringify({ ...payload(), role: "platform_admin", tenantId: null }),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(verifySession(`${forged}.${sig}`)).toBeNull();
    expect(body).not.toBe(forged);
  });

  it("rejects a tampered signature", () => {
    const token = signSession(payload());
    expect(verifySession(token.slice(0, -1) + "A")).toBeNull();
  });

  it("rejects an expired session", () => {
    const token = signSession(payload({ exp: Math.floor(Date.now() / 1000) - 10 }));
    expect(verifySession(token)).toBeNull();
  });

  it("rejects junk and empty input", () => {
    expect(verifySession(null)).toBeNull();
    expect(verifySession(undefined)).toBeNull();
    expect(verifySession("")).toBeNull();
    expect(verifySession("no-dot-here")).toBeNull();
    expect(verifySession(".onlysig")).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSession(payload());
    process.env.SESSION_SECRET = "a-completely-different-secret-key-32chars";
    expect(verifySession(token)).toBeNull();
    process.env.SESSION_SECRET = "test-secret-that-is-long-enough-to-pass-32";
  });

  it("refuses to operate without a strong secret", () => {
    const original = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "tooshort";
    expect(() => signSession(payload())).toThrow(/at least 32/);
    process.env.SESSION_SECRET = original;
  });
});
