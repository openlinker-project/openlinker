import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useConnectionsQuery } from '../hooks/use-connections-query';
import type { Connection, ConnectionStatus } from '../api/connections.types';
import { Alert } from '../../../shared/ui/alert';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
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
    return <p className="muted-text">Loading connections...</p>;
  }

  if (connectionsQuery.error) {
    return (
      <Alert tone="error" title="Unable to load connections">
        {connectionsQuery.error.message}
      </Alert>
    );
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
