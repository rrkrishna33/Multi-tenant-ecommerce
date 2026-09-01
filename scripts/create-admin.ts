/**
 * Creates a platform admin login (you, the software provider).
 *
 *   DATABASE_URL=... npx tsx scripts/create-admin.ts email@example.com "Your Name" password
 */
import { getPlatformDb } from "../src/db";
import { users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";
import { eq } from "drizzle-orm";

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password) {
  console.error('Usage: tsx scripts/create-admin.ts <email> "<name>" <password>');
  process.exit(1);
}

const db = getPlatformDb();
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
