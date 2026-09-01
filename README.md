# Crackers Platform

Multi-tenant e-commerce for Sivakasi firecracker shops. One codebase serves
every shop's storefront on its own domain; shops pay a monthly subscription and
bring nothing but a domain name.

## How multi-tenancy works

**One database, `tenant_id` on every table, Postgres row-level security.**

At 5–20 shops, schema-per-tenant means 20 sets of migrations to keep in sync and
20 connection pools on one VPS, for no isolation benefit that RLS does not
already give. The policies live in [`src/db/rls.sql`](src/db/rls.sql) and are
applied by `npm run db:setup`.

Two details carry the whole design:

- **`FORCE ROW LEVEL SECURITY`.** Without it, the table owner bypasses every
  policy — so if the app connects as the role that ran the migrations, the
  isolation silently does nothing. The app connects as `crackers_app`, which
  owns no tables.
- **Transaction-scoped tenant context.** `withTenant()` sets `app.tenant_id`
  with `set_config(..., is_local => true)` inside a transaction. A session-level
  `SET` would leak the previous request's tenant to the next request that
  borrows the same pooled connection.

Everything that touches tenant data goes through
[`withTenant()`](src/db/index.ts). A query that forgets its `WHERE tenant_id`
returns zero rows instead of another shop's orders.

### The one sanctioned exception

Sign-in must find a user by email **before** it knows their tenant, and under
RLS with no tenant context that lookup returns zero rows — so login fails for
everyone. That single query uses `getPlatformDb()`, which connects as the
BYPASSRLS `crackers_platform` role; the tenant check immediately after is what
re-imposes the boundary.

Nothing else may use it. Reaching for `getPlatformDb()` to avoid setting tenant
context is how the isolation gets quietly dismantled.
[`tests/login-rls.test.ts`](tests/login-rls.test.ts) pins both halves down.

## Custom domains

Clients point an A record at the VPS. On the first HTTPS request, Caddy's
on-demand TLS asks [`/api/internal/domain-check`](src/app/api/internal/domain-check/route.ts)
whether the domain belongs to a tenant, and issues a Let's Encrypt certificate
if it does. No per-tenant configuration, no manual certificate steps.

The `ask` endpoint is mandatory — without it anyone pointing DNS at the IP makes
the server request certificates on their behalf.

[`src/middleware.ts`](src/middleware.ts) maps the `Host` header to
`/sites/<tenant>/...`. It deliberately does no database work: middleware runs on
the Edge runtime, so the lookup happens in the page, on Node, behind a 60-second
cache.

## Payments: the estimate model

Indian payment aggregators classify fireworks as a restricted category, so
customer checkout does **not** use a gateway. The cart produces an estimate the
customer pays by UPI or bank transfer, and the shop marks it paid with the
reference. This is also how Sivakasi shops already sell.

Your own subscription billing to the shops is ordinary B2B SaaS revenue and can
use a normal gateway.

## Platform admin

Lives on your own domain at `/platform` — separate from the shop-facing admin,
and gated on the `platform_admin` role rather than tenant membership.

- **Add a shop** provisions the tenant, its owner login and its first
  subscription in one transaction. A half-created shop — one nobody can sign
  into — looks perfectly healthy on a list page, so it must never exist.
- **Shop detail** shows the DNS records to send the client, records subscription
  payments, and sets status by hand.
- Renewal **extends from the current expiry, not from today**, so a client who
  pays early never loses the days they already bought.

Create your own login:

```bash
npm run create-admin -- you@example.com "Your Name" <password>
```

### Subscription status

`trial` → no subscription on record. `active` → paid and current. `past_due` →
expired but inside a 7-day grace period, **still serving**. `suspended` → past
grace, storefront replaced by an unavailable notice.

The grace period is risk management, not generosity: a shop whose payment fails
on 20 October must not go dark during the only three weeks that matter. A
suspended shop still gets its certificate renewed, so its domain never shows a
browser security warning.

`npm run reconcile` recomputes all statuses from subscription expiry; run it
daily from cron.

## Domain details worth knowing

- **Money is integer paise everywhere.** Never floats.
- **Prices are derived**, not stored: shops set MRP + discount %, because the
  whole category advertises as "80% OFF". A stored sale price would drift.
- **Order items are snapshots.** Prices move constantly before Diwali; an old
  estimate must reprint identically.
- **The storefront is a bulk order table**, not a card grid. Customers fill
  quantities down a full price list in one pass, as on a paper order form.
- **Shipping is licensed road transport** — transporter name and LR number, not
  a courier API.
- **Estimate numbers restart at 1 per shop**, so one client's order volume is
  never visible to another.

## Adding products

Two routes, because shops need both:

- **CSV import** for the initial catalogue, and for a whole new season price
  list.
- **Add a product** in the shop admin for the rest of the season, when a shop
  adds one item at a time and re-uploading the price list would be absurd.

Each row has an **Edit** panel for changing any field, and a delete behind a
confirmation. Deleting is safe for history: order lines keep their own snapshot
of the product, so past estimates reprint unchanged.

The form takes prices in **rupees** ("500", "1,250.50", "Rs. 300") and converts
to integer paise; the shop never types paise and the database never stores a
string. Sale price previews live as MRP and discount are typed, so nobody has
to do MRP-minus-discount in their head.

A new category can be created inline from the same form — an existing category
with the same name is reused rather than duplicated. Products are capped by the
shop's plan (`maxProducts`), checked against the subscription through the
platform connection so a shop cannot read or raise its own cap.

Two validations worth knowing:

- **A YouTube link is parsed, not trusted.** The stored value is rendered as an
  `href` on the public storefront, so `javascript:` URLs, `data:` URLs and
  non-YouTube hosts (including lookalikes like `youtube.com.evil.test`) are all
  rejected, and accepted links are normalised to a canonical
  `watch?v=` form with tracking parameters stripped.
- **An absurd price is refused.** Over Rs 1,00,000 for a single box is far more
  likely an extra zero or paise typed as rupees than a real product, and a wrong
  price on a live storefront during Diwali is expensive in both directions.

The form is a `<details>` element rather than JS-toggled state, so it is
present in the server-rendered HTML and still works if the page's JavaScript
has not loaded — on a shop's phone, on rural mobile data in October, that is
not hypothetical.

### A sample price list

```bash
npm run sample-catalogue -- <slug>            # default: rvcrackers
npm run sample-catalogue -- <slug> --clear    # wipe the shop's catalogue first
```

63 products across 12 categories in the order every Sivakasi list uses — one
sound crackers through to gift boxes — with Tamil names, SKUs, pieces per unit
and 50-82% discounts. It is what a new shop or a demo needs before the owner has
their own CSV.

Safe to re-run: products are matched by SKU and existing ones are left alone.
Inserts go through `withTenant()`, so RLS applies to the script exactly as it
does to the app.

## Shop settings

`/admin/settings` lets the owner change what was previously fixed at tenant
creation: minimum order value, payment details, contact, GSTIN and licence,
tagline and colours.

**The minimum order value is the load-bearing one.** It is seeded at Rs 2,500,
and until this page existed there was no way to change it — so a shop whose
catalogue does not add up to that could take no orders at all. The checkout
button simply stayed disabled, with nothing telling the owner why. Setting it
to 0 removes the minimum entirely.

The page shows the owner what a customer will actually hit:

- how many of the cheapest item someone needs before checkout enables
- a warning when no UPI or bank details are set, because estimates then cannot
  say how to pay
- a warning when no phone number is set

### The customer notice

The owner can write one message that appears at the top of **every** page of
their shop — storefront, order page and estimate alike. It is what a shop needs
in the week before Diwali: "orders after the 18th are delivered after Diwali",
"no dispatch on Sunday", "free delivery above Rs 5,000".

- **A centred popup by default**, closed with the X, the button, Escape, or a
  click outside. A strip along the top of a price list gets scrolled past; a
  message a shop bothered to write should be read. "Strip along the top" is
  still there for something that must stay on screen.
- **The popup closes without JavaScript.** Dismissal is a `<label>` for a hidden
  checkbox, and CSS hides the dialog when it is checked. A React-only close
  button would leave a customer on rural mobile data in October staring at a
  modal they cannot get rid of, unable to order at all.
- **Dismissal is remembered per message, in `sessionStorage`.** Once per visit,
  not once per page; and editing the notice shows it again to everyone, which
  is the point of editing it.
- **It never pops up over the shop's own admin.** Middleware forwards the
  customer-facing path as `x-shop-path`, because the rewrite otherwise hides it
  from the layout — the owner sees their notice in the settings preview instead.
- **Three tones** — plain, highlighted, or red — because a running offer and a
  dispatch delay should not look the same. The tone becomes a `className`, so
  only those three values are accepted; anything else is rejected rather than
  rendered.
- **A separate on/off switch that keeps the text.** Shops reuse the same few
  messages every season, and unticking a box should not mean retyping the
  message next week.
- **Whitespace is collapsed**, so a notice pasted out of WhatsApp does not
  arrive as a five-line block that pushes the price list below the fold.
- It is **hidden when printing**, so it never appears on a printed estimate.

Saving revalidates the whole shop segment, not just the storefront: an urgent
notice that waited out a 5-minute cache window would be useless.

Colour fields are validated as hex literals — they are injected into a `<style>`
block on the public storefront, so anything else is a CSS injection.

## Why checkout ends in a full page load

`submitOrder` returns the new order's id and the client navigates with
`window.location.assign`. It deliberately does **not** call `redirect()`.

Every page here is reached through a middleware host rewrite, and a redirect out
of a server action is followed by the client router, not the browser: it fetches
the estimate as a flight request whose router state tree was built for the
rewritten path. That combination intermittently rendered "page not found" on an
estimate that had just been created — a page that loads perfectly on refresh,
which is exactly what customers reported.

A full navigation makes this hop identical to that refresh. It costs one page
load on the single most important transition in the app. The action's response
also renders a plain "Open your estimate" link, so the order is reachable even
if the navigation never runs.

## The About block

`/admin/settings` has an **About your shop** section — headline, about text,
mission, vision — plus a photo uploaded on its own form. Whatever is filled in
renders below the price list as an `#about` section, and the header gains an
"About us" link. Fill in nothing and the section does not exist.

It sits **below** the order table deliberately. A customer arriving from a
WhatsApp forward in October wants the price list; the shop's story is what they
read while deciding whether to trust an unfamiliar name with a Rs 4,000
transfer. Above the table it would only push the page's whole purpose off the
screen.

The text is stored and rendered as **plain text**, split into paragraphs on
blank lines. Rendering it as HTML would let anyone who reached a shop's admin
put script on that shop's customers. Leading whitespace and blank-line runs are
stripped on save, because this copy arrives pasted out of Word and WhatsApp.

The photo goes through the same pipeline as a product image — magic-byte
sniffing, generated filename, old file deleted on replace. It has its own form
because HTML forbids nesting forms, and because a rejected upload should not
discard the paragraphs the owner just typed. Saving the settings form carries
the photo across rather than overwriting it: both live in the same JSON column.

## Product images

Uploaded to a per-tenant directory on disk (`UPLOAD_DIR`), with a generated
UUID filename — a client-supplied filename is an attacker-supplied filename.

- **Type is decided by magic bytes**, never the filename or the browser's
  Content-Type, both of which the client controls.
- **SVG is rejected.** It is scriptable XML, and serving one from the shop's own
  origin would be stored XSS against their customers.
- Replacing a photo deletes the old file, so re-uploading through the season
  does not quietly fill the VPS disk.
- In production **Caddy serves `/uploads/*` straight from disk**, so Node never
  touches the read path. The Next route handler exists for development and as a
  fallback.

Filenames never repeat, so images are served `immutable` with a one-year cache.

## Estimate PDFs

`/order/<id>/pdf` renders a downloadable estimate so a shop can attach it to an
email or send it as a file on WhatsApp. The HTML page stays the primary
surface; the PDF is the version that survives being forwarded.

Built with **PDFKit, not headless Chrome**. Puppeteer would put a ~300 MB
browser on the VPS and spawn a process per render — during the Diwali peak
that is the shortest path to an OOM kill that takes every shop down at once.
PDFKit draws in-process in milliseconds.

Two font consequences worth knowing:

- Money is written `Rs.`, never `₹`. U+20B9 is not in Helvetica's WinAnsi
  encoding and would silently render as nothing.
- **Tamil product names are dropped from PDFs** unless you set `PDF_FONT_PATH`
  to a Unicode TTF such as Noto Sans Tamil. Helvetica cannot render Tamil and
  fails silently rather than erroring. The storefront and the HTML estimate show
  Tamil correctly either way — this affects the PDF only.

Long orders paginate with the column header repeated; a 60-line Diwali order is
normal here, not an edge case.

## Development

**`npm run dev` alone is the development command.** Do not run `npm run build`
first — it is for producing a production bundle to serve with `npm start`.

Dev and production builds write to different directories (`.next-dev` and
`.next`) precisely so the two can never interfere. They previously shared
`.next`, and a build running against a live dev server produced 404s on pages
that plainly existed and `Cannot find module './123.js'` errors — symptoms that
look nothing like their cause.

```bash
npm install
createdb crackers
DATABASE_URL=postgres://postgres:pw@localhost:5432/crackers npm run db:setup
DATABASE_URL=postgres://postgres:pw@localhost:5432/crackers npm run seed
npm run dev
```

Then visit `http://anil-crackers.localhost:3000` (Chrome and Firefox resolve
`*.localhost` automatically). Admin sign-in is at `/login` —
`owner@anilcrackers.test` / `crackers2026`.

## Tests

```bash
npm test
```

Tenant isolation is tested against **real Postgres** via PGlite (Postgres
compiled to WASM), with the production `rls.sql` applied and the connection
switched to the unprivileged `crackers_app` role — superusers bypass RLS, so
testing as one would prove nothing.

| Suite | Covers |
|---|---|
| `rls-isolation` | cross-tenant read/insert/update/delete, context cleanup |
| `orders` | price tampering, minimums, stock, per-shop numbering, snapshots |
| `pricing` | discount rounding, Indian digit grouping, price-list parsing |
| `tenant-routing` | subdomain vs custom domain, lookalike domains, cache TTL |
| `middleware` | host rewriting, internal-path probes, missing Host |
| `csv-import` | real price-list quirks: BOMs, banner rows, header aliases |
| `auth` | scrypt hashing, session forgery, expiry, secret rotation |
| `login-rls` | the sign-in lookup that RLS silently broke |
| `subscriptions` | month-end clamping, early renewal, grace period, slug/domain rules |
| `platform-service` | provisioning atomicity, duplicate guards, correlated-stat correctness |
| `uploads` | magic-byte sniffing, path traversal, SVG and disguised-executable rejection |
| `estimate-pdf` | decoded page content, pagination, totals, sparse-shop fallbacks |
| `products` | rupee parsing, typo guards, YouTube URL validation and `javascript:` rejection |
| `shop-settings` | minimum-order bounds, UPI/IFSC/GSTIN formats, colour injection |

## Deployment

See [`deploy/README.md`](deploy/README.md) for the Hostinger VPS setup, the
Caddy configuration, client domain onboarding, and Diwali capacity planning.
# Multi-tenant-ecommerce
