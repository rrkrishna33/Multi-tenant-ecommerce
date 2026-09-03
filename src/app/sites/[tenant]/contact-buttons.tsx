/**
 * Floating WhatsApp and call buttons.
 *
 * Half the orders in this trade are settled on the phone: a customer looks at
 * the price list, then asks "is this in stock, when will it reach Madurai".
 * Making them scroll back to the header to find the number is where that
 * conversation is lost.
 *
 * Inline SVG rather than an icon font or a CDN sprite -- these are two shapes,
 * and a shop's storefront should not make a request to a third party to render
 * its own phone number.
 *
 * A server component: no JavaScript, so the buttons work on a page whose script
 * has not loaded, which on rural mobile data in October is the normal case.
 */

/** wa.me wants a country-coded number with no punctuation. */
function whatsappHref(number: string): string {
  const digits = number.replace(/\D/g, "").slice(-10);
  return `https://wa.me/91${digits}`;
}

export function ContactButtons({
  phone,
  whatsapp,
}: {
  phone: string | null;
  whatsapp: string | null;
}) {
  if (!phone && !whatsapp) return null;

  return (
    <div className="contact-fab no-print">
      {whatsapp ? (
        <a
          className="contact-fab-btn whatsapp"
          href={whatsappHref(whatsapp)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Message this shop on WhatsApp"
          title="WhatsApp"
        >
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true" fill="currentColor">
            <path d="M16.04 3C9.4 3 4 8.4 4 15.04c0 2.12.55 4.19 1.6 6.02L4 29l8.13-1.55a12 12 0 0 0 3.9.66h.01C22.68 28.1 28 22.7 28 16.06 28 8.4 22.68 3 16.04 3zm0 22.36h-.01c-1.2 0-2.38-.24-3.48-.72l-.25-.1-4.82.92.92-4.7-.16-.26a9.94 9.94 0 0 1-1.53-5.3c0-5.5 4.48-9.98 10-9.98a9.9 9.9 0 0 1 7.03 2.92 9.86 9.86 0 0 1 2.9 7.02c0 5.5-4.48 9.98-9.98 9.98zm5.48-7.47c-.3-.15-1.77-.87-2.05-.97-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5s1.07 2.9 1.22 3.1c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35z" />
          </svg>
        </a>
      ) : null}

      {phone ? (
        <a
          className="contact-fab-btn call"
          href={`tel:${phone}`}
          aria-label={`Call this shop on ${phone}`}
          title={`Call ${phone}`}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="currentColor">
            <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.2.4 2.4.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.5 21 3 13.5 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .7-.2 1l-2.3 2.2z" />
          </svg>
        </a>
      ) : null}
    </div>
  );
}
