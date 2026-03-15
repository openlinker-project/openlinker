import type { ReactElement } from 'react';

export function SettingsPage(): ReactElement {
  return (
    <section className="page-section">
      <div className="page-header">
        <p className="eyebrow">Settings</p>
        <h2>Platform settings baseline</h2>
        <p>Settings should stay secondary to operator workflows and expose platform context without becoming the home page.</p>
      </div>

      <div className="workspace-grid">
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Runtime</p>
              <h3>Environment boundaries</h3>
            </div>
            <span className="panel__meta">Safe metadata only</span>
          </div>
          <p>Expose safe runtime metadata only. Secrets must never be present in browser code.</p>
        </article>
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Session</p>
              <h3>Auth evolution</h3>
            </div>
            <span className="panel__meta">Adapter based</span>
          </div>
          <p>The frontend currently uses a noop session adapter until backend auth becomes active.</p>
        </article>
      </div>
    </section>
  );
}
