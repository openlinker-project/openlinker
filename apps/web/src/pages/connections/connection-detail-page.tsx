import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useConnectionQuery } from '../../features/connections/hooks/use-connection-query';
import type { ConnectionStatus } from '../../features/connections/api/connections.types';
import { Alert } from '../../shared/ui/alert';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';

function toStatusTone(status: ConnectionStatus): StatusBadgeTone {
  switch (status) {
    case 'active':
      return 'success';
    case 'disabled':
      return 'neutral';
    case 'error':
      return 'error';
  }
}

export function ConnectionDetailPage(): ReactElement {
  const { connectionId = '' } = useParams();
  const connectionQuery = useConnectionQuery(connectionId);

  return (
    <section className="page-section">
      <div className="page-header">
        <p className="eyebrow">Integration detail</p>
        <h2>Connection {connectionId}</h2>
        <p>Detail views should combine configuration, health, status, and action context without hiding debug value.</p>
      </div>

      {connectionQuery.isLoading ? <p className="muted-text">Loading connection...</p> : null}
      {connectionQuery.error ? (
        <Alert tone="error" title="Unable to load connection">
          {connectionQuery.error.message}
        </Alert>
      ) : null}
      {connectionQuery.data ? (
        <div className="workspace-grid">
          <div className="panel panel--dense">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Connection summary</p>
                <h3 className="section-title">Current state</h3>
              </div>
              <StatusBadge tone={toStatusTone(connectionQuery.data.status)}>{connectionQuery.data.status}</StatusBadge>
            </div>

            <dl className="definition-list">
              <div>
                <dt>Name</dt>
                <dd>{connectionQuery.data.name}</dd>
              </div>
              <div>
                <dt>Platform</dt>
                <dd>{connectionQuery.data.platformType}</dd>
              </div>
              <div>
                <dt>Credentials ref</dt>
                <dd className="mono-text">{connectionQuery.data.credentialsRef}</dd>
              </div>
              <div>
                <dt>Adapter</dt>
                <dd className="mono-text">{connectionQuery.data.adapterKey ?? 'default adapter'}</dd>
              </div>
            </dl>
          </div>

          <div className="panel panel--dense">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Operator context</p>
                <h3 className="section-title">Suggested next actions</h3>
              </div>
              <span className="panel__meta">Guidance</span>
            </div>

            <ul className="check-list">
              <li>
                <strong>Validate auth state</strong>
                <span className="muted-text">Confirm credentials and permissions are still valid.</span>
              </li>
              <li>
                <strong>Check sync history</strong>
                <span className="muted-text">Future iterations should expose job runs and retry history here.</span>
              </li>
              <li>
                <strong>Review raw payloads</strong>
                <span className="muted-text">Debug access should become a first-class tab in later feature work.</span>
              </li>
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
