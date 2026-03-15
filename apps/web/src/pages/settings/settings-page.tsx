import type { ReactElement } from 'react';
import { PageLayout } from '../../shared/ui/page-layout';

export function SettingsPage(): ReactElement {
  return (
    <PageLayout
      eyebrow="Settings"
      title="Platform settings baseline"
      description="Settings should stay secondary to operator workflows and expose platform context without becoming the home page."
    >
      <div className="workspace-grid">
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Runtime</p>
              <h3 className="section-title">Environment boundaries</h3>
            </div>
            <span className="panel__meta">Safe metadata only</span>
          </div>
          <p className="panel-copy">Expose safe runtime metadata only. Secrets must never be present in browser code.</p>
        </article>
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Session</p>
              <h3 className="section-title">Auth evolution</h3>
            </div>
            <span className="panel__meta">Adapter based</span>
          </div>
          <p className="panel-copy">The frontend currently uses a noop session adapter until backend auth becomes active.</p>
        </article>
      </div>
    </PageLayout>
  );
}
