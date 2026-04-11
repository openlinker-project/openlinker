import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useConnectionQuery } from '../../features/connections/hooks/use-connection-query';
import { ConnectionActionsPanel } from '../../features/connections/components/ConnectionActionsPanel';
import { ConnectionConfigPanel } from '../../features/connections/components/ConnectionConfigPanel';
import { ConnectionDiagnosticsPanel } from '../../features/connections/components/ConnectionDiagnosticsPanel';
import type { ConnectionStatus } from '../../features/connections/api/connections.types';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
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

  const connection = connectionQuery.data;

  return (
    <PageLayout
      eyebrow="Integration detail"
      title={connection ? connection.name : `Connection ${connectionId}`}
      description="Connection overview, configuration, health, and operator actions."
      actions={
        <div className="button-group">
          {connection ? (
            <>
              <Link className="button button--primary" to={`/connections/${connectionId}/edit`}>
                Edit connection
              </Link>
              <Link className="button button--secondary" to={`/connections/${connectionId}/mappings`}>
                Mappings
              </Link>
            </>
          ) : null}
          <Link className="button button--secondary" to="/connections">
            Back to integrations
          </Link>
        </div>
      }
      summary={
        connection ? (
          <>
            <div className="toolbar__group">
              <span className="toolbar-chip">{connection.platformType}</span>
              <StatusBadge tone={toStatusTone(connection.status)}>{connection.status}</StatusBadge>
            </div>
            <div className="toolbar__group">
              <span className="muted-text">Created {new Date(connection.createdAt).toLocaleDateString()}</span>
            </div>
          </>
        ) : undefined
      }
    >
      {connectionQuery.isLoading ? (
        <LoadingState
          title="Loading connection"
          message="Fetching the latest connection summary and diagnostics."
        />
      ) : null}
      {connectionQuery.error ? (
        <ErrorState
          title="Unable to load connection"
          message={connectionQuery.error.message}
          action={
            <button type="button" className="button button--secondary" onClick={() => void connectionQuery.refetch()}>
              Retry
            </button>
          }
        />
      ) : null}
      {!connectionQuery.isLoading && !connectionQuery.error && !connection ? (
        <EmptyState
          title="Connection not found"
          message="No connection data was returned for this route. Retry from the integrations list or verify the selected identifier."
        />
      ) : null}
      {connection ? (
        <div className="workspace-grid">
          <div className="panel panel--dense">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Connection summary</p>
                <h3 className="section-title">Overview</h3>
              </div>
              <StatusBadge tone={toStatusTone(connection.status)}>{connection.status}</StatusBadge>
            </div>

            <dl className="definition-list">
              <div>
                <dt>Name</dt>
                <dd>{connection.name}</dd>
              </div>
              <div>
                <dt>Platform</dt>
                <dd>{connection.platformType}</dd>
              </div>
              <div>
                <dt>Credentials ref</dt>
                <dd className="mono-text">{connection.credentialsRef}</dd>
              </div>
              <div>
                <dt>Adapter</dt>
                <dd className="mono-text">{connection.adapterKey ?? 'default adapter'}</dd>
              </div>
              <div>
                <dt>Connection ID</dt>
                <dd className="mono-text">{connection.id}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{new Date(connection.updatedAt).toLocaleString()}</dd>
              </div>
            </dl>
          </div>

          <ConnectionConfigPanel config={connection.config} />
          <ConnectionDiagnosticsPanel connectionId={connection.id} />
          <ConnectionActionsPanel connection={connection} />
        </div>
      ) : null}
    </PageLayout>
  );
}
