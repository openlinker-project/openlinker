import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useConnectionsQuery } from '../hooks/use-connections-query';
import { EmptyState, ErrorState, LoadingState } from '../../../shared/ui/feedback-state';

export function ConnectionsOverview(): ReactElement {
  const connectionsQuery = useConnectionsQuery();

  if (connectionsQuery.isLoading) {
    return (
      <LoadingState
        title="Loading connections"
        message="Fetching the latest connection inventory and health summary."
      />
    );
  }

  if (connectionsQuery.error) {
    return (
      <ErrorState
        title="Unable to load connections"
        message={connectionsQuery.error.message}
        action={
          <button type="button" className="button button--secondary" onClick={() => void connectionsQuery.refetch()}>
            Retry
          </button>
        }
      />
    );
  }

  const connections = connectionsQuery.data ?? [];

  if (connections.length === 0) {
    return (
      <EmptyState
        title="No connections yet"
        message="Create the first connection to start configuring integrations."
        action={
          <Link className="button" to="/connections/new">
            Add the first connection
          </Link>
        }
      />
    );
  }

  return (
    <div className="list-card panel--dense">
      <div className="list-card__header">
        <div>
          <p className="eyebrow">Health overview</p>
          <h2 className="section-title">Connections</h2>
        </div>
        <span className="panel__meta">{connections.length} configured</span>
      </div>

      <ul className="connection-list">
        {connections.map((connection) => (
          <li key={connection.id} className="connection-list__item">
            <div>
              <strong>{connection.name}</strong>
              <p>
                {connection.platformType} · {connection.adapterKey ?? 'default adapter'}
              </p>
            </div>
            <div className="connection-list__meta">
              <span className="muted-text mono-text">{connection.id}</span>
              <span className={`status-pill status-pill--${connection.status}`}>{connection.status}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
