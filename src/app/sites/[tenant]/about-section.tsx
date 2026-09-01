/**
 * The "About us" block under the price list.
 *
 * It sits *below* the order table on purpose. A customer arriving from a
 * WhatsApp forward in October wants the price list; the shop's story is what
 * they read while deciding whether to trust an unfamiliar name with a
 * Rs 4,000 transfer. Putting it above the table would push the one thing the
 * page exists for off the screen.
 *
 * Nothing renders unless the shop has written something.
 */

export type AboutContent = {
  headline?: string;
  intro?: string;
  mission?: string;
  vision?: string;
  imageUrl?: string;
};

export type AboutShop = {
  shopName: string;
  phone: string | null;
  whatsapp: string | null;
  addressLine: string | null;
  city: string | null;
  pincode: string | null;
};

export function AboutSection({
  about,
  shop,
}: {
  about: AboutContent | undefined;
  shop: AboutShop;
}) {
  if (!about) return null;

  const hasBody = Boolean(about.intro || about.mission || about.vision);
  if (!hasBody && !about.headline) return null;

  return (
    <section className="about" id="about">
      <div className="wrap">
        <p className="about-eyebrow">About {shop.shopName}</p>

        {about.headline ? <h2 className="about-headline">{about.headline}</h2> : null}

        <div className={about.imageUrl ? "about-split" : undefined}>
          {about.imageUrl ? (
            <div className="about-figure">
              {/* eslint-disable-next-line @next/next/no-img-element -- served
                  straight off disk by Caddy; the optimiser would put Node back
                  on the read path for no gain. */}
              <img src={about.imageUrl} alt={shop.shopName} loading="lazy" />
              <div className="about-figure-caption">
                {shop.shopName}
                {shop.city ? <span>{shop.city}</span> : null}
              </div>
            </div>
          ) : null}

          <div className="about-body">
            {about.intro ? <Paragraphs text={about.intro} /> : null}

            {shop.phone ? (
              <p>
                <a className="btn about-call" href={`tel:${shop.phone}`}>
                  Call {shop.phone}
                  {shop.whatsapp && shop.whatsapp !== shop.phone ? `, ${shop.whatsapp}` : ""}
                </a>
              </p>
            ) : null}
          </div>
        </div>

        {about.mission || about.vision ? (
          <div className="about-cards">
            {about.mission ? (
              <div className="about-card">
                <h3>Our mission</h3>
                <Paragraphs text={about.mission} />
              </div>
            ) : null}
            {about.vision ? (
              <div className="about-card">
                <h3>Our vision</h3>
                <Paragraphs text={about.vision} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Renders blank-line-separated text as paragraphs.
 *
 * The text is a plain string from the database and stays one -- rendering it
 * as HTML would let a shop owner (or anyone who reached their admin) put
 * script on their own customers' pages.
 */
function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .map((para) => para.trim())
        .filter(Boolean)
        .map((para, i) => (
          <p key={i} style={{ whiteSpace: "pre-line" }}>
            {para}
          </p>
        ))}
    </>
  );
}
