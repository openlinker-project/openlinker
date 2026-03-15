import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useConnectionsQuery } from '../hooks/use-connections-query';
import type { Connection, ConnectionStatus } from '../api/connections.types';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { ErrorState, LoadingState, EmptyState } from '../../../shared/ui/feedback-state';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';

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

const columns: DataTableColumn<Connection>[] = [
  {
    id: 'name',
    header: 'Connection',
    cell: (connection) => (
      <div className="data-table__stack">
        <strong>{connection.name}</strong>
        <span className="muted-text">
          {connection.platformType} · {connection.adapterKey ?? 'default adapter'}
        </span>
      </div>
    ),
  },
  {
    id: 'identifier',
    header: 'Identifier',
    cell: (connection) => <span className="mono-text">{connection.id}</span>,
  },
  {
    id: 'status',
    header: 'Status',
    cell: (connection) => <StatusBadge tone={toStatusTone(connection.status)}>{connection.status}</StatusBadge>,
  },
  {
    id: 'actions',
    header: 'Action',
    cell: (connection) => (
      <Link className="data-table__action" to={`/connections/${connection.id}`}>
        View details
      </Link>
    ),
    align: 'right',
  },
];

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

      <DataTable
        caption="Configured connections"
        columns={columns}
        rowKey={(connection) => connection.id}
        rows={connections}
      />
    </div>
  );
}
