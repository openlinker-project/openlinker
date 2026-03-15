export function DashboardPage() {
  return (
    <section className="page-section">
      <div className="page-header">
        <p className="eyebrow">Overview</p>
        <h2>Operations overview</h2>
        <p>Monitor failures, retry pressure, integration health, and manual-review workload from one command surface.</p>
      </div>

      <section className="status-strip">
        <article className="metric-card">
          <span className="metric-card__label">Integration health</span>
          <strong className="metric-card__value">3 / 3</strong>
          <p>All channels connected</p>
        </article>
        <article className="metric-card metric-card--warning">
          <span className="metric-card__label">Jobs needing attention</span>
          <strong className="metric-card__value">2</strong>
          <p>1 failed, 1 retrying</p>
        </article>
        <article className="metric-card">
          <span className="metric-card__label">Inventory conflicts</span>
          <strong className="metric-card__value">0</strong>
          <p>No blocked syncs</p>
        </article>
        <article className="metric-card metric-card--review">
          <span className="metric-card__label">Manual reviews</span>
          <strong className="metric-card__value">1</strong>
          <p>1 operator checkpoint</p>
        </article>
      </section>

      <div className="workspace-grid workspace-grid--primary">
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Triage</p>
              <h3>Attention queue</h3>
            </div>
            <span className="panel__meta">Action now</span>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Entity</th>
                <th>Issue</th>
                <th>Source</th>
                <th>Since</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="status-pill status-pill--error">Failed</span></td>
                <td>Connection</td>
                <td>Allegro auth validation failed</td>
                <td className="mono-text">allegro.main</td>
                <td>12m</td>
                <td>Reconnect</td>
              </tr>
              <tr>
                <td><span className="status-pill status-pill--warning">Retrying</span></td>
                <td>Sync job</td>
                <td>Connection validation backoff in progress</td>
                <td className="mono-text">job_sync_1842</td>
                <td>4m</td>
                <td>Inspect</td>
              </tr>
              <tr>
                <td><span className="status-pill status-pill--review">Review</span></td>
                <td>Integration</td>
                <td>New setup waiting for credentials approval</td>
                <td className="mono-text">prestashop.draft</td>
                <td>21m</td>
                <td>Open</td>
              </tr>
            </tbody>
          </table>
        </article>

        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Health</p>
              <h3>Integration health</h3>
            </div>
            <span className="panel__meta">Last sync</span>
          </div>

          <ul className="check-list">
            <li>
              <strong>Allegro sandbox</strong>
              <span className="muted-text">Healthy · synced 2m ago</span>
            </li>
            <li>
              <strong>PrestaShop staging</strong>
              <span className="muted-text">Needs review · auth warning</span>
            </li>
            <li>
              <strong>Webhook intake</strong>
              <span className="muted-text">Healthy · 0 replay errors</span>
            </li>
          </ul>
        </article>
      </div>

      <div className="workspace-grid">
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Activity</p>
              <h3>Recent events</h3>
            </div>
            <span className="panel__meta">Timeline</span>
          </div>

          <ul className="timeline-list">
            <li>
              <span className="timeline-list__time">23:41</span>
              <div>
                <strong>Connection validated</strong>
                <p>Allegro sandbox credentials accepted and connection kept active.</p>
              </div>
            </li>
            <li>
              <span className="timeline-list__time">23:35</span>
              <div>
                <strong>Retry scheduled</strong>
                <p>Validation job entered retry backoff after transient upstream failure.</p>
              </div>
            </li>
            <li>
              <span className="timeline-list__time">23:18</span>
              <div>
                <strong>Manual review opened</strong>
                <p>A new integration draft is waiting for operator confirmation.</p>
              </div>
            </li>
          </ul>
        </article>

        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Failures</p>
              <h3>Retry and incident queue</h3>
            </div>
            <span className="panel__meta">Ops bridge</span>
          </div>

          <ul className="check-list">
            <li>
              <strong>Retry backlog</strong>
              <span className="muted-text">1 validation retry scheduled in the next 5 minutes</span>
            </li>
            <li>
              <strong>Manual review queue</strong>
              <span className="muted-text">1 connection setup blocked on credentials confirmation</span>
            </li>
            <li>
              <strong>Dead-letter queue</strong>
              <span className="muted-text">No failed events requiring replay</span>
            </li>
          </ul>
        </article>
      </div>
    </section>
  );
}
