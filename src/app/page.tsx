export default function PlatformHome() {
  return (
    <main className="wrap" style={{ paddingTop: 40, paddingBottom: 40 }}>
      <h1>Crackers Platform</h1>
      <p className="muted">
        Online ordering built for Sivakasi fireworks shops. Your own domain, your
        own price list, estimates ready to send in minutes.
      </p>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Shop owners</h2>
        <p>Sign in to manage your catalogue and orders.</p>
        <a className="btn" href="/platform">Platform admin</a>
      </div>
    </main>
  );
}
