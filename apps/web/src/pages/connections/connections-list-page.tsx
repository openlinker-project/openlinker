import { ConnectionsOverview } from '../../features/connections/components/connections-overview';

export function ConnectionsListPage() {
  return (
    <section className="page-section">
      <div className="page-header">
        <p className="eyebrow">Integrations</p>
        <h2>Integration control center</h2>
        <p>Review connection health, diagnose sync readiness, and manage channel configuration from one workspace.</p>
      </div>

      <div className="toolbar">
        <div className="toolbar__group">
          <span className="toolbar-chip">Status first</span>
          <span className="toolbar-chip">Debuggable</span>
          <span className="toolbar-chip">Operator workflow</span>
        </div>
        <div className="toolbar__group">
          <span className="muted-text">List to detail pattern</span>
        </div>
      </div>

      <ConnectionsOverview />
    </section>
  );
}
