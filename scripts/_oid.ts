import { getPlatformDb } from "../src/db";
import { sql } from "drizzle-orm";
const db = getPlatformDb();
const r = await db.execute(sql`select o.id from orders o join tenants t on t.id=o.tenant_id where t.slug='rvcrackers' order by o.created_at desc limit 1`);
console.log((r as any).rows[0].id);
process.exit(0);
