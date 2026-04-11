import type { ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import type { Connection, ConnectionFilters, ConnectionStatus, PlatformType } from '../../features/connections/api/connections.types';
import { PLATFORM_TYPES } from '../../features/connections/api/connections.types';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { ErrorState, LoadingState, EmptyState } from '../../shared/ui/feedback-state';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { Button } from '../../shared/ui/button';
import { PageLayout } from '../../shared/ui/page-layout';
import { Select } from '../../shared/ui/select';

const CONNECTION_STATUSES = ['active', 'disabled', 'error'] as const;

function isValidPlatformType(value: string): value is PlatformType {
  return PLATFORM_TYPES.includes(value as PlatformType);
}

function isValidStatus(value: string): value is ConnectionStatus {
  return CONNECTION_STATUSES.includes(value as ConnectionStatus);
}

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

const COLUMNS: DataTableColumn<Connection>[] = [
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

export function ConnectionsListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();

  const platformType = searchParams.get('platformType') ?? '';
  const status = searchParams.get('status') ?? '';

  const filters: ConnectionFilters = {
    platformType: isValidPlatformType(platformType) ? platformType : undefined,
    status: isValidStatus(status) ? status : undefined,
  };

  const query = useConnectionsQuery(filters);

  function handleFilterChange(key: string, value: string): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  return (
    <PageLayout
      eyebrow="Integrations"
      title="Connections"
      description="All configured integration connections — filter by platform or status."
      actions={
        <Link className="button" to="/connections/new">
          New connection
        </Link>
      }
    >
      {/* Filters */}
      <div className="toolbar">
        <div className="toolbar__group">
          <Select
            aria-label="Filter by platform"
            value={platformType}
            onChange={(e) => { handleFilterChange('platformType', e.target.value); }}
          >
            <option value="">All platforms</option>
            {PLATFORM_TYPES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </Select>
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => { handleFilterChange('status', e.target.value); }}
          >
            <option value="">All statuses</option>
            {CONNECTION_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </div>
      </div>

      {/* Content */}
      {query.isLoading ? (
        <LoadingState
          title="Loading connections"
          message="Fetching the latest connection inventory and health summary."
        />
      ) : query.error ? (
        <ErrorState
          title="Unable to load connections"
          message={query.error.message}
          action={
            <Button onClick={() => { void query.refetch(); }}>Retry</Button>
          }
        />
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState
          title="No connections found"
          message={
            filters.platformType || filters.status
              ? 'No connections match the current filters. Try adjusting your selection.'
              : 'Create the first connection to start configuring integrations.'
          }
          action={
            !filters.platformType && !filters.status ? (
              <Link className="button" to="/connections/new">
                Add the first connection
              </Link>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          caption="Configured connections"
          columns={COLUMNS}
          rowKey={(connection) => connection.id}
          rows={query.data ?? []}
        />
      )}
    </PageLayout>
  );
}
