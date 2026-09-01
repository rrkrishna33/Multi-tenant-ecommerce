/**
 * Shown instead of Next's bare 404 for anything under a shop's domain.
 *
 * The default black "404 This page could not be found" gives a customer no way
 * forward and gives the shop no idea what went wrong. The most common cause by
 * far is an estimate link that was mistyped, truncated by a messaging app, or
 * belongs to a different shop — so say that, and give them a route back.
 */
export default function ShopNotFound() {
  return (
    <main className="wrap" style={{ paddingTop: 48, paddingBottom: 64, maxWidth: 620 }}>
      <h1 style={{ marginBottom: 8 }}>We could not find that page</h1>

      <p className="muted">
        If you were opening an estimate link, it may have been cut short when it was
        shared, or it may belong to a different shop.
      </p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>What to try</h3>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>Check the full link was copied — estimate links are long.</li>
          <li>Open it on the same shop website you ordered from.</li>
          <li>
            Contact the shop with your estimate number (it looks like{" "}
            <strong>EST-0007</strong>) and they can resend it.
          </li>
        </ul>
      </div>

      <p>
        <a className="btn" href="/">
          Back to the shop
        </a>
      </p>
    </main>
  );
}
