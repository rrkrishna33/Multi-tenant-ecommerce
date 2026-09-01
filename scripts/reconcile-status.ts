/**
 * Recomputes every tenant's status from its subscription expiry.
 *
 * Run daily from cron:
 *   0 3 * * * cd /opt/crackers && npx tsx scripts/reconcile-status.ts >> /var/log/crackers-billing.log 2>&1
 *
 * Safe to run repeatedly. Shops inside the grace period stay live on purpose --
 * see GRACE_PERIOD_DAYS in src/lib/subscriptions.ts.
 */
import { reconcileTenantStatuses } from "../src/lib/platform-service";

const changes = await reconcileTenantStatuses();

if (changes.length === 0) {
  console.log(`[${new Date().toISOString()}] no status changes`);
} else {
  for (const c of changes) {
    console.log(`[${new Date().toISOString()}] ${c.slug}: ${c.from} -> ${c.to}`);
  }
}
process.exit(0);
