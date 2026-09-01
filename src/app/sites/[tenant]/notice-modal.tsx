"use client";

import { useEffect, useRef } from "react";

/**
 * The shop's notice as a centred popup shown when a customer opens the site.
 *
 * Two decisions shape this component:
 *
 * 1. **It closes without JavaScript.** The dismiss control is a `<label>` for a
 *    hidden checkbox, and CSS hides the dialog once that checkbox is checked.
 *    A React-only close button would leave a customer on rural mobile data —
 *    the exact customer this shop has in October — staring at a modal they
 *    cannot get rid of, unable to order.
 *
 * 2. **Dismissal is remembered per message, in sessionStorage.** Keying on the
 *    message text means changing the notice shows it again to everyone, which
 *    is the whole point of changing it; sessionStorage means it appears once
 *    per visit rather than on every page, and again on the customer's next
 *    visit.
 */
export function NoticeModal({
  message,
  tone,
  shopName,
}: {
  message: string;
  tone: string;
  shopName: string;
}) {
  const toggle = useRef<HTMLInputElement>(null);

  // A short, stable key. Not a security boundary — just enough that editing
  // the notice produces a different one.
  const key = `notice:${hash(message)}`;

  useEffect(() => {
    const el = toggle.current;
    if (!el) return;

    try {
      if (sessionStorage.getItem(key) === "1") el.checked = true;
    } catch {
      // Private mode, or storage blocked. Showing the notice once more is the
      // harmless failure here, so carry on.
    }

    const remember = () => {
      if (!el.checked) return;
      try {
        sessionStorage.setItem(key, "1");
      } catch {
        /* ignore */
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !el.checked) {
        el.checked = true;
        remember();
      }
    };

    el.addEventListener("change", remember);
    document.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("change", remember);
      document.removeEventListener("keydown", onKey);
    };
  }, [key]);

  return (
    <div className="notice-modal no-print">
      {/* Rendered unchecked on both server and client; the effect above ticks
          it after hydration if this visit has already seen the message. */}
      <input
        ref={toggle}
        type="checkbox"
        id="notice-dismiss"
        className="notice-modal-toggle"
        aria-hidden="true"
        tabIndex={-1}
      />

      <div className="notice-modal-backdrop">
        {/* Clicking outside closes it, as every dialog on the web does. */}
        <label className="notice-modal-scrim" htmlFor="notice-dismiss" aria-hidden="true" />

        <div
          className={`notice-modal-card ${toneClass(tone)}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="notice-modal-title"
        >
          <label className="notice-modal-x" htmlFor="notice-dismiss" title="Close">
            &times;
          </label>

          <h2 id="notice-modal-title" className="notice-modal-title">
            {shopName}
          </h2>
          <p className="notice-modal-body">{message}</p>

          <label className="btn notice-modal-ok" htmlFor="notice-dismiss">
            Continue to the price list
          </label>
        </div>
      </div>
    </div>
  );
}

/** The tone lands in a className, so only the three known values are allowed. */
function toneClass(tone: string | undefined): string {
  return tone === "urgent" || tone === "offer" ? tone : "info";
}

function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
