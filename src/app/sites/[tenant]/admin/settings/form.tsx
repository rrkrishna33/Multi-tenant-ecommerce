"use client";

import { useActionState, useState } from "react";
import { updateSettingsAction, type SettingsState } from "../actions";
import { formatInr } from "@/lib/pricing";
import { ANNOUNCEMENT_MAX, ABOUT_HEADLINE_MAX, ABOUT_BODY_MAX } from "@/lib/shop-settings";

type Shop = {
  shopName: string;
  minOrderValue: number;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
  licenseNumber: string | null;
  upiId: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  themeConfig: {
    tagline?: string;
    primaryColor?: string;
    accentColor?: string;
    announcement?: string;
    announcementTone?: string;
    announcementDisplay?: string;
    announcementOn?: boolean;
    about?: {
      headline?: string;
      intro?: string;
      mission?: string;
      vision?: string;
      imageUrl?: string;
    };
  } | null;
};

/** Mirrors the whitelist the storefront applies, so the preview cannot lie. */
function toneClass(tone: string): string {
  return tone === "urgent" || tone === "offer" ? tone : "info";
}

export function SettingsForm({ shop, cheapest }: { shop: Shop; cheapest: number | null }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    updateSettingsAction,
    {},
  );
  const [minOrder, setMinOrder] = useState((shop.minOrderValue / 100).toFixed(2));
  const theme = shop.themeConfig ?? {};
  const about = theme.about ?? {};

  // The notice is the one setting whose whole point is how it looks to a
  // customer, so it is edited against a live copy of the real banner.
  const [notice, setNotice] = useState(theme.announcement ?? "");
  const [tone, setTone] = useState(theme.announcementTone ?? "info");
  const [display, setDisplay] = useState(theme.announcementDisplay ?? "popup");
  const [noticeOn, setNoticeOn] = useState(theme.announcementOn ?? false);

  const err = (field: string) =>
    state.field === field ? (
      <div className="muted" style={{ color: "var(--err)" }}>
        {state.error}
      </div>
    ) : null;

  // How many of the cheapest item a customer must buy before checkout enables.
  const minPaise = Math.round(Number(minOrder.replace(/[^\d.]/g, "")) * 100);
  const unitsNeeded =
    cheapest && cheapest > 0 && Number.isFinite(minPaise) && minPaise > 0
      ? Math.ceil(minPaise / cheapest)
      : null;

  return (
    <form action={action}>
      {state.saved ? <div className="notice ok">Settings saved.</div> : null}
      {state.error && !state.field ? <div className="notice error">{state.error}</div> : null}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Shop</h3>
        <div className="field">
          <label htmlFor="shopName">Shop name</label>
          <input id="shopName" name="shopName" required defaultValue={shop.shopName} />
          {err("shopName")}
        </div>
        <div className="field">
          <label htmlFor="tagline">Tagline</label>
          <input
            id="tagline"
            name="tagline"
            defaultValue={theme.tagline ?? ""}
            placeholder="Direct from Sivakasi since 1994"
          />
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Ordering</h3>
        <div className="field">
          <label htmlFor="minOrderValue">Minimum order value (rupees)</label>
          <input
            id="minOrderValue"
            name="minOrderValue"
            required
            inputMode="decimal"
            value={minOrder}
            onChange={(e) => setMinOrder(e.target.value)}
          />
          {err("minOrderValue")}
          <div className="muted">
            Customers cannot place an order below this. Set it to 0 to remove the
            minimum entirely.
          </div>
          {unitsNeeded !== null ? (
            <div
              className="muted"
              style={{ color: unitsNeeded > 10 ? "var(--warn)" : undefined, marginTop: 4 }}
            >
              At your cheapest price ({formatInr(cheapest!)}), a customer needs about{" "}
              <strong>{unitsNeeded}</strong> of them before they can check out.
            </div>
          ) : null}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Notice to customers</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Shown at the top of every page of your shop. Use it for anything a
          customer should read before they start ordering — last date for Diwali
          orders, a delivery delay, a shop holiday, a running offer.
        </p>

        <div className="field">
          <label htmlFor="announcement">Message</label>
          <textarea
            id="announcement"
            name="announcement"
            rows={2}
            maxLength={ANNOUNCEMENT_MAX}
            value={notice}
            onChange={(e) => setNotice(e.target.value)}
            placeholder="Orders placed after 18 October will be delivered after Diwali."
          />
          {err("announcement")}
          <div className="muted">
            {notice.trim().length}/{ANNOUNCEMENT_MAX} characters
          </div>
        </div>

        <div className="field">
          <label htmlFor="announcementTone">How it should look</label>
          <select
            id="announcementTone"
            name="announcementTone"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
          >
            <option value="info">Plain — general information</option>
            <option value="offer">Highlighted — an offer or good news</option>
            <option value="urgent">Red — a delay, a closure, a deadline</option>
          </select>
          {err("announcementTone")}
        </div>

        <div className="field">
          <label htmlFor="announcementDisplay">Where it appears</label>
          <select
            id="announcementDisplay"
            name="announcementDisplay"
            value={display}
            onChange={(e) => setDisplay(e.target.value)}
          >
            <option value="popup">Popup in the centre — customers must close it</option>
            <option value="banner">Strip along the top — always visible</option>
          </select>
          {err("announcementDisplay")}
          <div className="muted">
            The popup opens once per visit and can be closed. Use the strip for
            something that should stay on screen, like a minimum order note.
          </div>
        </div>

        <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <input
            type="checkbox"
            name="announcementOn"
            checked={noticeOn}
            onChange={(e) => setNoticeOn(e.target.checked)}
          />
          <span>Show this notice on my shop</span>
        </label>
        <div className="muted" style={{ marginTop: -6, marginBottom: 12 }}>
          Switching it off hides the notice but keeps the text, so you can put the
          same message back next week without retyping it.
        </div>

        {notice.trim() ? (
          <>
            <div className="muted" style={{ marginBottom: 4 }}>
              {noticeOn ? "Customers see:" : "Preview (currently hidden):"}
            </div>
            {display === "banner" ? (
              <div
                className={`announce ${toneClass(tone)}`}
                style={{ opacity: noticeOn ? 1 : 0.55, borderRadius: "var(--radius)" }}
              >
                <div style={{ padding: "0 12px" }}>{notice.trim()}</div>
              </div>
            ) : (
              <div
                style={{
                  background: "rgba(0,0,0,0.25)",
                  padding: 16,
                  borderRadius: "var(--radius)",
                  opacity: noticeOn ? 1 : 0.55,
                }}
              >
                <div
                  className={`notice-modal-card ${toneClass(tone)}`}
                  style={{ position: "static", animation: "none", margin: "0 auto" }}
                >
                  <h2 className="notice-modal-title">{shop.shopName}</h2>
                  <p className="notice-modal-body">{notice.trim()}</p>
                  <span className="btn notice-modal-ok">Continue to the price list</span>
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>How customers pay you</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          These are printed on every estimate. Without at least one, customers are
          told to phone you instead.
        </p>
        <div className="field">
          <label htmlFor="upiId">UPI ID</label>
          <input id="upiId" name="upiId" defaultValue={shop.upiId ?? ""} placeholder="shop@okaxis" />
          {err("upiId")}
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="bankAccountName">Account name</label>
            <input
              id="bankAccountName"
              name="bankAccountName"
              defaultValue={shop.bankAccountName ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="bankAccountNumber">Account number</label>
            <input
              id="bankAccountNumber"
              name="bankAccountNumber"
              defaultValue={shop.bankAccountNumber ?? ""}
            />
            {err("bankAccountNumber")}
          </div>
        </div>
        <div className="field">
          <label htmlFor="bankIfsc">IFSC code</label>
          <input id="bankIfsc" name="bankIfsc" defaultValue={shop.bankIfsc ?? ""} placeholder="HDFC0001234" />
          {err("bankIfsc")}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>About your shop</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Shown below your price list, and linked as &ldquo;About us&rdquo; in the
          header. This is what a customer reads while deciding whether to trust an
          unfamiliar shop with a large transfer, so it is worth writing properly.
          Leave it all blank and the section does not appear at all.
        </p>

        <div className="field">
          <label htmlFor="aboutHeadline">Headline</label>
          <input
            id="aboutHeadline"
            name="aboutHeadline"
            maxLength={ABOUT_HEADLINE_MAX}
            defaultValue={about.headline ?? ""}
            placeholder="Welcome to R.V.Crackers, where every celebration sparks joy"
          />
          {err("aboutHeadline")}
        </div>

        <div className="field">
          <label htmlFor="aboutIntro">About us</label>
          <textarea
            id="aboutIntro"
            name="aboutIntro"
            rows={6}
            maxLength={ABOUT_BODY_MAX}
            defaultValue={about.intro ?? ""}
            placeholder={
              "We have supplied Sivakasi crackers to families across Tamil Nadu since 1994.\n\nEvery box is packed at our own licensed unit and dispatched by licensed road transport."
            }
          />
          {err("aboutIntro")}
          <div className="muted">
            Leave a blank line between paragraphs. Up to {ABOUT_BODY_MAX} characters.
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="aboutMission">Our mission</label>
            <textarea
              id="aboutMission"
              name="aboutMission"
              rows={4}
              maxLength={ABOUT_BODY_MAX}
              defaultValue={about.mission ?? ""}
              placeholder="To bring safe, tested, factory-price crackers to every family."
            />
            {err("aboutMission")}
          </div>
          <div className="field">
            <label htmlFor="aboutVision">Our vision</label>
            <textarea
              id="aboutVision"
              name="aboutVision"
              rows={4}
              maxLength={ABOUT_BODY_MAX}
              defaultValue={about.vision ?? ""}
              placeholder="To be the shop Tamil Nadu orders from first, every Diwali."
            />
            {err("aboutVision")}
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Contact</h3>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="phone">Phone</label>
            <input id="phone" name="phone" defaultValue={shop.phone ?? ""} placeholder="9842012345" />
            {err("phone")}
          </div>
          <div className="field">
            <label htmlFor="whatsapp">WhatsApp</label>
            <input id="whatsapp" name="whatsapp" defaultValue={shop.whatsapp ?? ""} />
            {err("whatsapp")}
          </div>
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" defaultValue={shop.email ?? ""} />
          {err("email")}
        </div>
        <div className="field">
          <label htmlFor="addressLine">Address</label>
          <input id="addressLine" name="addressLine" defaultValue={shop.addressLine ?? ""} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="city">City / Town</label>
            <input id="city" name="city" defaultValue={shop.city ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="pincode">PIN code</label>
            <input id="pincode" name="pincode" defaultValue={shop.pincode ?? ""} />
            {err("pincode")}
          </div>
        </div>
        <div className="field">
          <label htmlFor="state">State</label>
          <input id="state" name="state" defaultValue={shop.state ?? ""} />
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Legal</h3>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="gstin">GSTIN</label>
            <input id="gstin" name="gstin" defaultValue={shop.gstin ?? ""} />
            {err("gstin")}
          </div>
          <div className="field">
            <label htmlFor="licenseNumber">Explosives licence number</label>
            <input
              id="licenseNumber"
              name="licenseNumber"
              defaultValue={shop.licenseNumber ?? ""}
            />
          </div>
        </div>
        <p className="muted">Both are printed on estimates when set.</p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Colours</h3>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="primaryColor">Main colour</label>
            <input
              id="primaryColor"
              name="primaryColor"
              defaultValue={theme.primaryColor ?? ""}
              placeholder="#c62828"
            />
            {err("primaryColor")}
          </div>
          <div className="field">
            <label htmlFor="accentColor">Accent colour</label>
            <input
              id="accentColor"
              name="accentColor"
              defaultValue={theme.accentColor ?? ""}
              placeholder="#f9a825"
            />
            {err("accentColor")}
          </div>
        </div>
      </div>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save settings"}
      </button>
    </form>
  );
}
