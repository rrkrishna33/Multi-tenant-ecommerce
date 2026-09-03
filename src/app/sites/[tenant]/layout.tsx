import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getTenantByKey } from "@/lib/tenant-db";
import { isServable } from "@/lib/tenant";
import { getDb } from "@/db";
import { tenants } from "@/db/schema";
import { NoticeModal } from "./notice-modal";
import { ContactButtons } from "./contact-buttons";

type Props = {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tenant: key } = await params;
  const tenant = await getTenantByKey(key);
  if (!tenant) return { title: "Shop not found" };
  return {
    title: `${tenant.shopName} - Online Crackers Ordering`,
    description: `Order Sivakasi crackers online from ${tenant.shopName}. Wholesale rates, delivery across Tamil Nadu.`,
  };
}

export default async function TenantLayout({ children, params }: Props) {
  const { tenant: key } = await params;
  const resolved = await getTenantByKey(key);

  if (!resolved) notFound();

  // Full shop record for header details and theming.
  const [shop] = await getDb().select().from(tenants).where(eq(tenants.id, resolved.id));

  if (!isServable(resolved)) {
    return (
      <main className="wrap" style={{ paddingTop: 60, textAlign: "center" }}>
        <h1>{shop.shopName}</h1>
        <div className="notice error">
          This store is temporarily unavailable. Please contact the shop directly
          {shop.phone ? ` on ${shop.phone}` : ""}.
        </div>
      </main>
    );
  }

  const theme = shop.themeConfig ?? {};
  const path = (await headers()).get("x-shop-path") ?? "/";

  const customerFacing = !path.startsWith("/admin") && !path.startsWith("/login");
  // An estimate is a document, and it is read by the shop as often as by the
  // customer -- from the admin's "view estimate", where the shop's own notice
  // to customers is pure noise. The notice belongs on the way IN to a shop, not
  // over an order that has already been placed.
  const storefront = customerFacing && !path.startsWith("/order");

  const about = theme.about;
  const hasAbout = Boolean(about?.headline || about?.intro || about?.mission || about?.vision);

  const hasNotice = Boolean(theme.announcementOn && theme.announcement);
  // The popup interrupts, so it is limited to the storefront's front page --
  // the moment someone arrives. The strip is passive enough to sit on any
  // shopping page.
  const showPopup = hasNotice && storefront && path === "/" && theme.announcementDisplay !== "banner";
  const showBanner = hasNotice && storefront && theme.announcementDisplay === "banner";

  return (
    <>
      {/* Per-tenant theming without a build step: the shop's colours override
          the CSS custom properties the whole stylesheet is written against. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `:root{${theme.primaryColor ? `--brand:${cssColor(theme.primaryColor)};` : ""}${
            theme.accentColor ? `--accent:${cssColor(theme.accentColor)};` : ""
          }}`,
        }}
      />
      <header className="site-header">
        <div className="wrap">
          <div>
            <h1>
              <a href="/" style={{ textDecoration: "none" }}>
                {shop.shopName}
              </a>
            </h1>
            {theme.tagline ? <p className="tagline">{theme.tagline}</p> : null}
          </div>
          <div className="contact">
            {/* Only offered when there is something to jump to. */}
            {hasAbout && customerFacing ? (
              <div>
                <a href="/#about">About us</a>
              </div>
            ) : null}
            {shop.phone ? (
              <div>
                Call <a href={`tel:${shop.phone}`}>{shop.phone}</a>
              </div>
            ) : null}
            {shop.whatsapp ? (
              <div>
                WhatsApp{" "}
                <a href={`https://wa.me/91${shop.whatsapp.replace(/\D/g, "").slice(-10)}`}>
                  {shop.whatsapp}
                </a>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      {showPopup ? (
        <NoticeModal
          message={theme.announcement!}
          tone={theme.announcementTone ?? "info"}
          shopName={shop.shopName}
        />
      ) : null}
      {showBanner ? (
        <div
          className={`announce no-print ${toneClass(theme.announcementTone)}`}
          role="status"
        >
          <div className="wrap">{theme.announcement}</div>
        </div>
      ) : null}
      {children}

      {/* Customer-facing only: the shop does not need a button to phone
          itself while working in its own admin. */}
      {customerFacing ? (
        <ContactButtons phone={shop.phone} whatsapp={shop.whatsapp} />
      ) : null}
      <footer className="wrap no-print" style={{ padding: "32px 16px", fontSize: 13 }}>
        <p className="muted">
          {shop.shopName}
          {shop.addressLine ? `, ${shop.addressLine}` : ""}
          {shop.city ? `, ${shop.city}` : ""}
          {shop.pincode ? ` - ${shop.pincode}` : ""}
        </p>
        {shop.licenseNumber ? (
          <p className="muted">Explosives Licence: {shop.licenseNumber}</p>
        ) : null}
        <p className="muted">
          As per Supreme Court orders, online sale of firecrackers is restricted. Orders
          placed here are treated as enquiries and are fulfilled offline in accordance
          with applicable regulations.
        </p>
      </footer>
    </>
  );
}

/**
 * The tone is a stored string, and it lands in a className. Whitelisting is
 * what stops a bad value becoming an arbitrary class on a public page.
 */
function toneClass(tone: string | undefined): string {
  return tone === "urgent" || tone === "offer" ? tone : "info";
}

/** Only allow simple colour literals into the injected style block. */
function cssColor(value: string): string {
  return /^#[0-9a-f]{3,8}$/i.test(value.trim()) ? value.trim() : "";
}
