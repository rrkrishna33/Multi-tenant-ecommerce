# Deploying to a Hostinger VPS

Target: one KVM instance running Next.js, PostgreSQL and Caddy. This comfortably
carries 5–20 shops outside the season; see **Diwali capacity** below for the peak.

## 1. Base setup

Ubuntu 24.04, as root:

```bash
apt update && apt upgrade -y
apt install -y postgresql postgresql-contrib git ufw

# Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

Install Caddy from the official repository:

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

## 2. Database

```bash
sudo -u postgres createdb crackers
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'a-strong-password';"
```

Then from the app directory:

```bash
DATABASE_URL=postgres://postgres:a-strong-password@localhost:5432/crackers \
  npm run db:setup
```

`db:setup` applies the migrations, then `src/db/rls.sql`, and prints the RLS
status of every table. **Check that output.** Every tenant table must read
`enabled + forced`; `tenants` is intentionally unprotected because domain
routing has to resolve a host before any tenant context exists.

Set passwords for the two application roles it created:

```bash
sudo -u postgres psql -c "ALTER ROLE crackers_app PASSWORD 'app-password';"
sudo -u postgres psql -c "ALTER ROLE crackers_platform PASSWORD 'platform-password';"
```

The app connects as `crackers_app`, which owns no tables — that is what makes
`FORCE ROW LEVEL SECURITY` apply to it. Never point `DATABASE_URL` at
`postgres`; a superuser bypasses every policy and the isolation silently stops
existing.

## 3. Application

```bash
git clone <your repo> /opt/crackers && cd /opt/crackers
npm ci && npm run build
```

`/opt/crackers/.env`:

```
DATABASE_URL=postgres://crackers_app:app-password@localhost:5432/crackers
PLATFORM_DOMAIN=yourplatform.com
SESSION_SECRET=<64 random hex chars: openssl rand -hex 32>
NODE_ENV=production
```

`/etc/systemd/system/crackers.service`:

```ini
[Unit]
Description=Crackers platform
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/crackers
EnvironmentFile=/opt/crackers/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now crackers
```

## 4. Caddy

Copy `deploy/Caddyfile` to `/etc/caddy/Caddyfile`, replacing `yourplatform.com`
and the email address, then `systemctl reload caddy`.

For the wildcard `*.yourplatform.com` certificate you need a DNS challenge,
which requires a Caddy build with your DNS provider's plugin:

```bash
caddy add-package github.com/caddy-dns/cloudflare
```

and a `tls` block with your API token. If you would rather avoid that, drop the
wildcard and let each tenant subdomain be issued on demand like the custom
domains — it costs one extra certificate per shop, which is nothing at 20 shops.

## 5. Your platform admin login

```bash
cd /opt/crackers
npm run create-admin -- you@example.com "Your Name" <a-strong-password>
```

Then sign in at `https://yourplatform.com/platform`.

Add the daily billing reconciliation to cron:

```
0 3 * * * cd /opt/crackers && npx tsx scripts/reconcile-status.ts >> /var/log/crackers-billing.log 2>&1
```

Set `SERVER_IP` in `.env` to your VPS address so the shop detail page shows
clients the exact DNS records to add.

## 6. Onboarding a client

1. In **Platform Admin → Add shop**, enter the shop name, owner login, plan and
   (optionally) their domain.
2. The shop is immediately live at `slug.yourplatform.com`.
3. Tell the client to add these records at their registrar:

   | Type | Name | Value |
   |------|------|-------|
   | A    | @    | `<VPS IP>` |
   | A    | www  | `<VPS IP>` |

4. That is all. On the first HTTPS request Caddy asks
   `/api/internal/domain-check`, sees the domain in the `tenants` table, and
   issues a Let's Encrypt certificate automatically.

Register the apex in the `custom_domain` column; the app resolves `www` to the
same shop, and vice versa, so clients pointing only one of them still work.

## Diwali capacity

Roughly 90% of the year's orders land in about three weeks. Plan for it:

- **Resize the VPS in September**, not October. Hostinger resizes KVM plans in
  place, so it is a planned reboot rather than a migration. Going from KVM 2 to
  KVM 4/8 for two months costs far less than one hour of downtime during the
  peak.
- **Storefront pages are cached** (`revalidate = 300`), so Postgres mostly sees
  order writes rather than catalogue reads.
- **Back up more often.** Nightly is fine in June; twice daily from late
  September:

  ```
  0 2 * * * pg_dump crackers | gzip > /var/backups/crackers-$(date +\%F).sql.gz
  ```

  Copy those off the box — a backup on the same VPS is not a backup.
- **Watch `max_connections`.** The pool is capped at 15 in `src/db/index.ts`.
  Raising it beyond what Postgres allows turns a traffic spike into a database
  outage for every shop at once.

## Security checklist

- [ ] `DATABASE_URL` uses `crackers_app`, never `postgres`
- [ ] `npm run db:setup` reported `enabled + forced` on every tenant table
- [ ] `SESSION_SECRET` is 32+ random characters and not shared with any other env
- [ ] `/api/internal/domain-check` is reachable only from localhost
- [ ] Postgres is not listening on a public interface (`listen_addresses = 'localhost'`)
- [ ] Automatic security updates enabled (`unattended-upgrades`)
