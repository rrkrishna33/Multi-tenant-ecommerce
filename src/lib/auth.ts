import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64;

/**
 * Password hashing with scrypt.
 *
 * scrypt is in the Node standard library, which matters here: this runs on a
 * single small VPS with no native build toolchain, and adding bcrypt/argon2
 * means node-gyp on every deploy.
 */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;

  let expected: Buffer;
  try {
    expected = Buffer.from(hash, "hex");
  } catch {
    return false;
  }
  if (expected.length !== KEYLEN) return false;

  const derived = await scrypt(password, salt, KEYLEN);
  // Constant-time compare so a response-timing difference cannot be used to
  // recover the hash byte by byte.
  return timingSafeEqual(derived, expected);
}

export type SessionPayload = {
  userId: string;
  tenantId: string | null;
  role: "platform_admin" | "shop_owner" | "shop_staff";
  exp: number; // unix seconds
};

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters");
  }
  return s;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Signed session cookie. Stateless so there is no session table to clean up,
 * and no Redis to run alongside Postgres on the same small box.
 */
export function signSession(payload: SessionPayload): string {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = createHmac("sha256", secret()).update(body).digest();
  let given: Buffer;
  try {
    given = fromB64url(sig);
  } catch {
    return null;
  }
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(given, expected)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    return null;
  }

  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
  return payload;
}

export const SESSION_COOKIE = "crackers_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
