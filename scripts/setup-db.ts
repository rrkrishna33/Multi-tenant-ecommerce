/**
 * One-shot database setup: applies generated migrations, then the RLS policies.
 *
 * Connects as a SUPERUSER, because it creates roles and applies policies. The
 * application itself connects as the unprivileged `crackers_app` role that
 * rls.sql creates, which is what makes the row-level security policies bite.
 *
 * It uses SUPERUSER_DATABASE_URL when set, so `.env` can hold both connections
 * at once and DATABASE_URL never has to be temporarily pointed at `postgres` --
 * a swap that is easy to make and easy to forget to undo, and leaves the app
 * running as a role that bypasses every policy.
 *
 *   npm run db:setup
 */
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const url = process.env.SUPERUSER_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("Set SUPERUSER_DATABASE_URL (or DATABASE_URL) to a superuser connection.");
    process.exit(1);
  }
  if (!process.env.SUPERUSER_DATABASE_URL) {
    console.warn(
      "SUPERUSER_DATABASE_URL is not set; using DATABASE_URL. This only works if that role can create roles.",
    );
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    const dir = join(ROOT, "drizzle");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      process.stdout.write(`Applying ${file}... `);
      const sql = readFileSync(join(dir, file), "utf8");
      for (const stmt of sql.split("--> statement-breakpoint")) {
        const trimmed = stmt.trim();
        if (!trimmed) continue;
        try {
          await client.query(trimmed);
        } catch (err: any) {
          // Re-running setup on an existing database is normal and should be
          // safe, so tolerate "already exists" but surface everything else.
          if (err.code === "42P07" || err.code === "42710" || err.code === "42P16") continue;
          throw err;
        }
      }
      console.log("done");
    }

    process.stdout.write("Applying row-level security policies... ");
    await client.query(readFileSync(join(ROOT, "src", "db", "rls.sql"), "utf8"));
    console.log("done");

    const { rows } = await client.query(`
      select tablename, rowsecurity, relforcerowsecurity
      from pg_tables
      join pg_class on pg_class.relname = pg_tables.tablename
      where schemaname = 'public'
      order by tablename
    `);

    console.log("\nRow-level security status:");
    for (const r of rows) {
      const state = r.rowsecurity
        ? r.relforcerowsecurity
          ? "enabled + forced"
          : "enabled (NOT forced)"
        : "disabled";
      console.log(`  ${r.tablename.padEnd(16)} ${state}`);
    }
    console.log("\nSetup complete. `tenants` is intentionally not protected.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
