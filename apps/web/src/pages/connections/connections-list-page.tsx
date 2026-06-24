import type { ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import type { Connection, ConnectionFilters, ConnectionStatus } from '../../features/connections/api/connections.types';
import { usePlatforms } from '../../shared/plugins';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { useTableSort } from '../../shared/ui/use-table-sort';
import { ErrorState, LoadingState, EmptyState } from '../../shared/ui/feedback-state';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { Button } from '../../shared/ui/button';
import { PageLayout } from '../../shared/ui/page-layout';
import { Select } from '../../shared/ui/select';
import { usePermission } from '../../shared/auth/use-permission';

const CONNECTION_STATUSES = ['active', 'disabled', 'error', 'needs_reauth'] as const;

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
    case 'needs_reauth':
      return 'warning';
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
    accessor: (connection) => connection.name,
    sortable: true,
  },
  {
    id: 'identifier',
    header: 'Identifier',
    cell: (connection) => (
      <span className="mono-text" title={connection.id}>
        {connection.id}
      </span>
    ),
    hideBelow: 1024,
  },
  {
    id: 'status',
    header: 'Status',
    cell: (connection) => <StatusBadge tone={toStatusTone(connection.status)}>{connection.status}</StatusBadge>,
    accessor: (connection) => connection.status,
    sortable: true,
  },
];

export function ConnectionsListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sort, setSort } = useTableSort([{ id: 'name', desc: false }]);
  const plugins = usePlatforms();
  const canWrite = usePermission('connections:write');

  const platformType = searchParams.get('platformType') ?? '';
  const status = searchParams.get('status') ?? '';
  const isKnownPlatform = platformType !== '' && plugins.some((p) => p.platformType === platformType);

  const filters: ConnectionFilters = {
    platformType: isKnownPlatform ? platformType : undefined,
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

  function clearFilters(): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('platformType');
      next.delete('status');
      return next;
    });
  }

  const filtersActive = Boolean(filters.platformType || filters.status);

  return (
    <PageLayout
      eyebrow="Integrations"
      title="Connections"
      description="All configured integration connections — filter by platform or status."
      actions={
        canWrite ? (
          <Link className="button" to="/connections/new">
            New connection
          </Link>
        ) : null
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
            {plugins.map((p) => (
              <option key={p.platformType} value={p.platformType}>{p.displayName}</option>
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
            filtersActive
              ? 'No connections match the current filters.'
              : 'Create the first connection to start configuring integrations.'
          }
          action={
            filtersActive ? (
              <Button onClick={clearFilters}>Clear filters</Button>
            ) : canWrite ? (
              <Link className="button button--primary" to="/connections/new">
                Add the first connection
              </Link>
            ) : null
          }
        />
      ) : (
        <DataTable
          caption="Configured connections"
          columns={COLUMNS}
          rowKey={(connection) => connection.id}
          rows={query.data ?? []}
          rowHref={(connection) => `/connections/${connection.id}`}
          sort={sort}
          onSortChange={setSort}
          cardView={{
            title: (connection) => connection.name,
            subtitle: (connection) =>
              `${connection.platformType} · ${connection.adapterKey ?? 'default adapter'}`,
            meta: (connection) => (
              <StatusBadge tone={toStatusTone(connection.status)} compact>
                {connection.status}
              </StatusBadge>
            ),
          }}
        />
      )}
    </PageLayout>
  );
}
