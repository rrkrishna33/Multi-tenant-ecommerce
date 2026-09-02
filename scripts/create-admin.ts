/**
 * Creates a platform admin login (you, the software provider).
 *
 * There are no default credentials anywhere in this codebase, by design: a
 * platform admin can read and change every shop, so a seeded default would be
 * the first thing an attacker tried against a public VPS.
 *
 * Run it again with the same email to reset that admin's password.
 *
 *   npm run create-admin -- you@example.com "Your Name" <password>
 *
 * Connects as PLATFORM_DATABASE_URL: platform admins have a NULL tenant_id and
 * are deliberately invisible under tenant context.
 */
import { getPlatformDb } from "../src/db";
import { users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";
import { eq, sql } from "drizzle-orm";

/**
 * `npm run` re-splits its arguments on whitespace, so a quoted "Krishnakumar
 * Ravi" arrives as two arguments and the password silently becomes the
 * surname. Taking the email first, the password last, and treating everything
 * between as the name makes the quoting irrelevant.
 */
const args = process.argv.slice(2);
const email = args[0];
const password = args[args.length - 1];
const name = args.slice(1, -1).join(" ");

if (args.length < 3 || !email || !name || !password) {
  console.error('Usage: npm run create-admin -- <email> "<name>" <password>');
  process.exit(1);
}
if (!email.includes("@")) {
  console.error(`"${email}" does not look like an email address.`);
  process.exit(1);
}
if (password.length < 8) {
  console.error("Use a password of at least 8 characters.");
  process.exit(1);
}

const db = getPlatformDb();

/**
 * A platform admin has a NULL tenant_id, so the tenant_isolation policy refuses
 * the insert on any connection that is subject to RLS. That is the policy
 * working -- but the raw Postgres error names neither the cause nor the fix, so
 * check the role up front and say what to do.
 */
const [role] = (
  await db.execute(
    sql`select current_user as name, rolbypassrls from pg_roles where rolname = current_user`,
  )
).rows as { name: string; rolbypassrls: boolean }[];

if (!role?.rolbypassrls) {
  console.error(
    [
      `Connected as "${role?.name ?? "unknown"}", which is subject to row-level security.`,
      "A platform admin has no tenant, so RLS will refuse to create one.",
      "",
      "Set PLATFORM_DATABASE_URL in .env to the crackers_platform role:",
      "  PLATFORM_DATABASE_URL=postgres://crackers_platform:<password>@localhost:5432/crackers",
      "",
      "If you do not have that password, reset it as the postgres superuser:",
      "  ALTER ROLE crackers_platform WITH PASSWORD '<new password>';",
      "",
      "Sign-in uses the same variable, so without it nobody can log in either.",
    ].join("\n"),
  );
  process.exit(1);
}

const normalized = email.trim().toLowerCase();
const [existing] = await db.select().from(users).where(eq(users.email, normalized));

if (existing) {
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), name, role: "platform_admin", tenantId: null })
    .where(eq(users.id, existing.id));
  console.log(`Updated platform admin ${normalized}`);
} else {
  await db.insert(users).values({
    tenantId: null,
    email: normalized,
    name,
    role: "platform_admin",
    passwordHash: await hashPassword(password),
  });
  console.log(`Created platform admin ${normalized}`);
}
process.exit(0);
