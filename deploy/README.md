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

Then, with `.env` in place (step 3 -- `db:setup` reads `SUPERUSER_DATABASE_URL`
from it):

```bash
npm run db:setup
```

`db:setup` applies the migrations, then `src/db/rls.sql`, and prints what it
produced. **Check both halves of that output.**

Every tenant table must read `enabled + forced`; `tenants` is intentionally
unprotected because domain routing has to resolve a host before any tenant
context exists. And the roles must read:

```
  crackers_app       login=true bypassrls=false  ok
  crackers_platform  login=true bypassrls=true   ok
```

`crackers_platform` without `bypassrls` is the quiet killer: sign-in finds no
user and every login fails, looking exactly like a wrong password.

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

`/opt/crackers/.env` -- copy `.env.example`, which documents every variable and
what breaks if it is wrong:

```
DATABASE_URL=postgres://crackers_app:app-password@localhost:5432/crackers
PLATFORM_DATABASE_URL=postgres://crackers_platform:platform-password@localhost:5432/crackers
SUPERUSER_DATABASE_URL=postgres://postgres:a-strong-password@localhost:5432/crackers
PLATFORM_DOMAIN=yourplatform.com
SESSION_SECRET=<64 random hex chars: openssl rand -hex 32>
SERVER_IP=<your VPS IP>
UPLOAD_DIR=/var/lib/crackers/uploads
NODE_ENV=production
```

**`PLATFORM_DATABASE_URL` is not optional in production.** Left out, the app
falls back to `DATABASE_URL`, which is subject to RLS, and nobody can sign in --
shop owners included. It warns about this at startup, in the journal.

Create the upload directory as the user the service runs as:

```bash
mkdir -p /var/lib/crackers/uploads
chown -R www-data:www-data /var/lib/crackers/uploads
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
(two places) and the email address, then `systemctl reload caddy`.

**DNS.** Three records, all pointing at the VPS:

| Type | Name | Value |
|---|---|---|
| A | `@` | your VPS IP |
| A | `www` | your VPS IP |
| A | `*` | your VPS IP |

The wildcard is what makes a new shop live at `slug.yourplatform.com` the
moment you create it, with no DNS work per shop.

### Already running nginx?

Caddy needs ports 80 and 443, and only one process can hold them. If nginx is
already serving other sites on this box, put Caddy in front and move nginx to a
local port rather than choosing between them:

```nginx
# /etc/nginx/sites-enabled/*  -- change every `listen 80;` to:
listen 127.0.0.1:8080;
# and drop any listen 443 / ssl_certificate lines: Caddy terminates TLS now.
```

```caddyfile
# In the Caddyfile, before the https:// block -- your existing sites, by name.
oldsite.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

Caddy gets certificates for those too, so they end up better off than before.

**Why not keep nginx in front and script certbot?** Because every client domain
would then need a certbot run and a reload, and a failure is invisible until a
customer sees a browser security warning on the shop's own domain -- in
October, on the one week that matters. It is buildable (a cron job reading
`tenants.custom_domain` and issuing what is missing), but it is rebuilding, less
reliably, the ten lines of `on_demand_tls` above.

**Certificates.** The config issues one certificate per hostname on demand,
including tenant subdomains. It deliberately does *not* use a
`*.yourplatform.com` wildcard certificate: that can only be issued over a
DNS-01 challenge, which needs a Caddy built with your DNS provider's plugin
(`caddy add-package github.com/caddy-dns/cloudflare`) and an API token sitting
on the box. At 5-20 shops the difference is invisible, and it is one less thing
to hold correct.

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
