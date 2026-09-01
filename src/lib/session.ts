import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getPlatformDb } from "@/db";
import { users } from "@/db/schema";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  signSession,
  verifySession,
  verifyPassword,
  type SessionPayload,
} from "./auth";

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

/**
 * Authenticates a shop user against a specific tenant.
 *
 * The tenant comes from the resolved host, never from the form. Otherwise a
 * user of shop A could sign in through shop B's login page and land in shop
 * B's admin.
 */
export async function login(
  email: string,
  password: string,
  tenantId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = email.trim().toLowerCase();

  // Uses the RLS-bypassing connection deliberately: we cannot set tenant
  // context before we know which tenant the user belongs to. The tenant check
  // below is what re-imposes the boundary.
  const [user] = await getPlatformDb()
    .select()
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);

  // Do the hash comparison even when the user does not exist, so the response
  // time does not reveal which email addresses are registered.
  const stored = user?.passwordHash ?? "scrypt$00$" + "0".repeat(128);
  const passwordOk = await verifyPassword(password, stored);

  if (!user || !passwordOk) {
    return { ok: false, error: "Incorrect email or password." };
  }

  // A shop user may only sign in on their own shop's domain.
  if (user.role !== "platform_admin" && user.tenantId !== tenantId) {
    return { ok: false, error: "Incorrect email or password." };
  }

  const jar = await cookies();
  jar.set(
    SESSION_COOKIE,
    signSession({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    }),
    sessionCookieOptions(),
  );

  return { ok: true };
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/** Returns the session only if it belongs to this shop (or a platform admin). */
export async function requireShopAccess(tenantId: string): Promise<SessionPayload | null> {
  const session = await getSession();
  if (!session) return null;
  if (session.role === "platform_admin") return session;
  if (session.tenantId !== tenantId) return null;
  return session;
}

export async function requirePlatformAdmin(): Promise<SessionPayload | null> {
  const session = await getSession();
  return session?.role === "platform_admin" ? session : null;
}
