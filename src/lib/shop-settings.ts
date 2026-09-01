import { z } from "zod";
import { parseRupeesToPaise, PricingError } from "./pricing";

/**
 * Shop settings the owner controls themselves.
 *
 * Every field here was previously fixed at tenant creation with no way to
 * change it. The minimum order value in particular is load-bearing: it is
 * seeded at Rs 2,500, and a shop whose catalogue does not add up to that can
 * take no orders at all, with the checkout button simply refusing to enable.
 */

export class SettingsError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
  }
}

/**
 * A shop notice long enough for "Diwali orders close on the 18th, dispatch
 * resumes on the 25th" and short enough that a customer reads it before the
 * price list. Anything longer belongs on the phone.
 */
export const ANNOUNCEMENT_MAX = 300;

export const ANNOUNCEMENT_TONES = ["info", "offer", "urgent"] as const;
export type AnnouncementTone = (typeof ANNOUNCEMENT_TONES)[number];

/**
 * A popup is read; a strip at the top of a price list is scrolled past. So
 * "popup" is the default for a message a shop bothered to write.
 */
export const ANNOUNCEMENT_DISPLAYS = ["popup", "banner"] as const;
export type AnnouncementDisplay = (typeof ANNOUNCEMENT_DISPLAYS)[number];

/**
 * The About block is marketing copy, not a brochure -- a customer who came to
 * buy crackers should reach the price list. These caps are generous enough for
 * the three or four paragraphs shops actually write.
 */
export const ABOUT_HEADLINE_MAX = 120;
export const ABOUT_BODY_MAX = 1500;

const blankToNull = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v));

export const settingsSchema = z.object({
  shopName: z.string().trim().min(2, "Enter the shop name.").max(120),
  minOrderValue: z.string().trim(),

  phone: blankToNull(20),
  whatsapp: blankToNull(20),
  email: blankToNull(200),

  addressLine: blankToNull(300),
  city: blankToNull(100),
  state: blankToNull(100),
  pincode: blankToNull(10),

  gstin: blankToNull(20),
  licenseNumber: blankToNull(60),

  upiId: blankToNull(100),
  bankAccountName: blankToNull(120),
  bankAccountNumber: blankToNull(30),
  bankIfsc: blankToNull(20),

  tagline: blankToNull(160),
  primaryColor: blankToNull(9),
  accentColor: blankToNull(9),

  announcement: blankToNull(ANNOUNCEMENT_MAX),
  announcementTone: blankToNull(10),
  announcementDisplay: blankToNull(10),
  announcementOn: z.union([z.string(), z.boolean()]).optional(),

  aboutHeadline: blankToNull(ABOUT_HEADLINE_MAX),
  aboutIntro: blankToNull(ABOUT_BODY_MAX),
  aboutMission: blankToNull(ABOUT_BODY_MAX),
  aboutVision: blankToNull(ABOUT_BODY_MAX),
});

export type ShopSettings = {
  shopName: string;
  minOrderValue: number; // paise
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
    announcementTone?: AnnouncementTone;
    announcementDisplay?: AnnouncementDisplay;
    announcementOn?: boolean;
    about?: {
      headline?: string;
      intro?: string;
      mission?: string;
      vision?: string;
      imageUrl?: string;
    };
  };
};

const PHONE_RE = /^(\+91[\s-]?)?[6-9]\d{9}$/;
const PINCODE_RE = /^[1-9]\d{5}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d][A-Z\d]$/;
const UPI_RE = /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9.\-_]{1,63}$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** An unchecked HTML checkbox posts nothing at all, so absence means off. */
function checkboxOn(value: string | boolean | undefined): boolean {
  if (typeof value === "boolean") return value;
  return value !== undefined && value !== "" && value !== "off" && value !== "false";
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function parseShopSettings(raw: unknown): ShopSettings {
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SettingsError(issue.message, String(issue.path[0] ?? ""));
  }
  const v = parsed.data;

  let minOrderValue: number;
  try {
    minOrderValue = parseRupeesToPaise(v.minOrderValue);
  } catch (err) {
    if (err instanceof PricingError) {
      throw new SettingsError(
        `"${v.minOrderValue}" is not a valid amount.`,
        "minOrderValue",
      );
    }
    throw err;
  }
  if (minOrderValue < 0) {
    throw new SettingsError("Minimum order cannot be negative.", "minOrderValue");
  }
  // A minimum above a lakh means no customer can ever check out. Refusing it
  // is friendlier than letting a shop silently take zero orders through the
  // only three weeks that matter.
  if (minOrderValue > 100_000_00) {
    throw new SettingsError(
      "That minimum is too high — customers would not be able to order.",
      "minOrderValue",
    );
  }

  for (const [field, value, label] of [
    ["phone", v.phone, "phone number"],
    ["whatsapp", v.whatsapp, "WhatsApp number"],
  ] as const) {
    if (value && !PHONE_RE.test(value)) {
      throw new SettingsError(`Enter a valid 10-digit ${label}.`, field);
    }
  }

  if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) {
    throw new SettingsError("Enter a valid email address.", "email");
  }
  if (v.pincode && !PINCODE_RE.test(v.pincode)) {
    throw new SettingsError("Enter a valid 6-digit PIN code.", "pincode");
  }
  if (v.gstin && !GSTIN_RE.test(v.gstin.toUpperCase())) {
    throw new SettingsError("That does not look like a valid GSTIN.", "gstin");
  }
  if (v.upiId && !UPI_RE.test(v.upiId)) {
    throw new SettingsError("Enter a valid UPI ID, for example shop@okaxis.", "upiId");
  }
  if (v.bankIfsc && !IFSC_RE.test(v.bankIfsc.toUpperCase())) {
    throw new SettingsError("Enter a valid 11-character IFSC code.", "bankIfsc");
  }
  if (v.bankAccountNumber && !/^\d{6,20}$/.test(digitsOnly(v.bankAccountNumber))) {
    throw new SettingsError("Enter a valid bank account number.", "bankAccountNumber");
  }
  for (const [field, value] of [
    ["primaryColor", v.primaryColor],
    ["accentColor", v.accentColor],
  ] as const) {
    if (value && !HEX_RE.test(value)) {
      throw new SettingsError("Use a colour code like #c62828.", field);
    }
  }

  // Whitespace is collapsed so a notice pasted from WhatsApp does not arrive
  // as a five-line block that pushes the price list off the screen.
  const announcement = v.announcement ? v.announcement.replace(/\s+/g, " ").trim() : null;
  if (announcement && announcement.length > ANNOUNCEMENT_MAX) {
    throw new SettingsError(
      `Keep the notice under ${ANNOUNCEMENT_MAX} characters.`,
      "announcement",
    );
  }

  const tone = v.announcementTone ?? "info";
  if (!(ANNOUNCEMENT_TONES as readonly string[]).includes(tone)) {
    throw new SettingsError("Choose how the notice should look.", "announcementTone");
  }

  const display = v.announcementDisplay ?? "popup";
  if (!(ANNOUNCEMENT_DISPLAYS as readonly string[]).includes(display)) {
    throw new SettingsError("Choose where the notice should appear.", "announcementDisplay");
  }

  const announcementOn = checkboxOn(v.announcementOn);
  if (announcementOn && !announcement) {
    throw new SettingsError(
      "Write the notice before switching it on.",
      "announcement",
    );
  }

  // Paragraph breaks are kept (the About block renders them), but runs of
  // blank lines and trailing spaces from a pasted Word document are not.
  const tidy = (value: string | null): string | undefined => {
    if (!value) return undefined;
    const cleaned = value
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      // Word and WhatsApp both paste leading spaces on every line, and the
      // About block renders line breaks as written.
      .replace(/^[ \t]+/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return cleaned || undefined;
  };

  // The headline is one line in a large font; a newline in it just breaks the
  // layout.
  const headline = v.aboutHeadline
    ? v.aboutHeadline.replace(/\s+/g, " ").trim() || undefined
    : undefined;

  const about = {
    ...(headline ? { headline } : {}),
    ...(tidy(v.aboutIntro) ? { intro: tidy(v.aboutIntro)! } : {}),
    ...(tidy(v.aboutMission) ? { mission: tidy(v.aboutMission)! } : {}),
    ...(tidy(v.aboutVision) ? { vision: tidy(v.aboutVision)! } : {}),
  };

  return {
    shopName: v.shopName,
    minOrderValue,
    phone: v.phone,
    whatsapp: v.whatsapp,
    email: v.email ? v.email.toLowerCase() : null,
    addressLine: v.addressLine,
    city: v.city,
    state: v.state,
    pincode: v.pincode,
    gstin: v.gstin ? v.gstin.toUpperCase() : null,
    licenseNumber: v.licenseNumber,
    upiId: v.upiId,
    bankAccountName: v.bankAccountName,
    bankAccountNumber: v.bankAccountNumber ? digitsOnly(v.bankAccountNumber) : null,
    bankIfsc: v.bankIfsc ? v.bankIfsc.toUpperCase() : null,
    themeConfig: {
      ...(v.tagline ? { tagline: v.tagline } : {}),
      ...(v.primaryColor ? { primaryColor: v.primaryColor } : {}),
      ...(v.accentColor ? { accentColor: v.accentColor } : {}),
      // The text is kept even when the notice is switched off, so a shop can
      // reuse last week's message without retyping it.
      ...(announcement
        ? {
            announcement,
            announcementTone: tone as AnnouncementTone,
            announcementDisplay: display as AnnouncementDisplay,
          }
        : {}),
      ...(announcementOn ? { announcementOn: true } : {}),
      ...(Object.keys(about).length > 0 ? { about } : {}),
    },
  };
}

/**
 * Warnings shown on the settings page. These are not errors — a shop can save
 * and keep selling — but each one is something a customer will run into.
 */
export function settingsWarnings(
  s: Pick<ShopSettings, "minOrderValue" | "upiId" | "bankAccountNumber" | "phone">,
  cheapestSalePrice: number | null,
): string[] {
  const out: string[] = [];

  if (!s.upiId && !s.bankAccountNumber) {
    out.push(
      "No UPI ID or bank account set, so estimates cannot tell customers how to pay.",
    );
  }
  if (!s.phone) {
    out.push("No phone number set, so customers have no way to reach you.");
  }
  if (
    cheapestSalePrice !== null &&
    cheapestSalePrice > 0 &&
    s.minOrderValue > cheapestSalePrice * 10
  ) {
    out.push(
      "Your minimum order is high compared with your prices — customers may need a very large quantity before they can check out.",
    );
  }

  return out;
}
