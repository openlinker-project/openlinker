export function AllegroConnectCallbackPage() {
  return (
    <section className="page-section">
      <div className="page-header">
        <p className="eyebrow">OAuth callback</p>
        <h2>Allegro callback checkpoint</h2>
        <p>This route reserves the browser return point for a future step-based integration onboarding flow.</p>
      </div>

      <div className="panel panel--dense">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Setup wizard</p>
            <h3>Flow placeholder</h3>
          </div>
          <span className="panel__meta">Reserved route</span>
        </div>
        <p>FE-001 defines the route boundary now so OAuth can be added later without changing the shell or page model.</p>
      </div>
    </section>
  );
}
