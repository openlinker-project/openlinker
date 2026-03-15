import { useConnectionsQuery } from '../hooks/use-connections-query';

export function ConnectionsOverview() {
  const connectionsQuery = useConnectionsQuery();

  if (connectionsQuery.isLoading) {
    return <p className="muted-text">Loading connections...</p>;
  }

  if (connectionsQuery.error) {
    return <p className="error-text">Unable to load connections: {connectionsQuery.error.message}</p>;
  }

  const connections = connectionsQuery.data ?? [];

  if (connections.length === 0) {
    return (
      <div className="empty-state">
        <h2>No connections yet</h2>
        <p>Create the first connection to start configuring integrations.</p>
      </div>
    );
  }

  return (
    <div className="list-card panel--dense">
      <div className="list-card__header">
        <div>
          <p className="eyebrow">Health overview</p>
          <h2>Connections</h2>
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
