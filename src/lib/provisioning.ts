import { z } from "zod";
import { RESERVED_SUBDOMAINS, normalizeHost } from "./tenant";

/**
 * Rules for creating a tenant. Kept separate from the database layer so the
 * validation is testable on its own -- these are the checks that decide whether
 * a client's shop can ever be reached, and getting one wrong is discovered by
 * an angry phone call rather than a stack trace.
 */

// 2-50 characters. The optional-tail form of this pattern also matched a
// single character, which the stated rule does not allow -- and a one-letter
// subdomain is worth refusing anyway, since they are the scarcest names we
// have to hand out.
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
}

export type SlugCheck = { ok: true } | { ok: false; message: string };

export function checkSlug(slug: string): SlugCheck {
  if (!SLUG_RE.test(slug)) {
    return {
      ok: false,
      message:
        "Use 2-50 characters: lowercase letters, numbers and hyphens, not starting or ending with a hyphen.",
    };
  }
  if (RESERVED_SUBDOMAINS.has(slug)) {
    return { ok: false, message: `"${slug}" is reserved for platform use.` };
  }
  return { ok: true };
}

/**
 * Validates a client's custom domain.
 *
 * Rejects anything that is not a plain registrable hostname. A URL, a path or a
 * port pasted in here would be stored verbatim and then never match the Host
 * header, leaving a shop that is silently unreachable on the domain they paid
 * for.
 */
export type DomainCheck =
  | { ok: true; domain: string }
  | { ok: false; message: string };

export function checkCustomDomain(raw: string, platformDomain: string): DomainCheck {
  let value = raw.trim().toLowerCase();
  if (value === "") return { ok: false, message: "Enter a domain name." };

  if (/^https?:\/\//.test(value)) {
    value = value.replace(/^https?:\/\//, "");
  }
  value = value.split("/")[0];
  value = normalizeHost(value);

  if (value.includes(" ")) {
    return { ok: false, message: "A domain cannot contain spaces." };
  }
  if (!value.includes(".")) {
    return { ok: false, message: "Enter a full domain, for example anilcrackers.com" };
  }
  if (value.length > 253) {
    return { ok: false, message: "That domain is too long." };
  }

  const labels = value.split(".");
  for (const label of labels) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) {
      return { ok: false, message: `"${label}" is not a valid part of a domain name.` };
    }
  }
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1])) {
    return { ok: false, message: "That does not look like a real domain ending." };
  }

  // A client cannot claim a name under our own domain; those are ours to issue.
  const base = normalizeHost(platformDomain);
  if (value === base || value.endsWith(`.${base}`)) {
    return {
      ok: false,
      message: `${base} subdomains are assigned automatically and cannot be set as a custom domain.`,
    };
  }

  return { ok: true, domain: value };
}

export const createTenantSchema = z.object({
  shopName: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(50),
  ownerName: z.string().trim().min(2).max(120),
  ownerEmail: z.string().trim().email().max(200),
  ownerPassword: z.string().min(8).max(200),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  customDomain: z.string().trim().max(253).optional().or(z.literal("")),
  plan: z.enum(["starter", "standard", "premium"]),
  periodMonths: z.coerce.number().int().refine((n) => n === 1 || n === 12, {
    message: "Choose monthly or yearly billing.",
  }),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;

/** DNS records a client must add at their registrar. */
export function dnsInstructions(serverIp: string) {
  return [
    { type: "A", name: "@", value: serverIp },
    { type: "A", name: "www", value: serverIp },
  ];
}
