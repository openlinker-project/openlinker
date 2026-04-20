import type { ReactElement } from 'react';
import { useAdaptersQuery } from '../../features/adapters/hooks/use-adapters-query';
import type { AdapterSummary } from '../../features/adapters/api/adapters.types';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { ErrorState, LoadingState, EmptyState } from '../../shared/ui/feedback-state';
import { StatusBadge } from '../../shared/ui/status-badge';
import { Button } from '../../shared/ui/button';
import { PageLayout } from '../../shared/ui/page-layout';

const COLUMNS: DataTableColumn<AdapterSummary>[] = [
  {
    id: 'adapter',
    header: 'Adapter',
    cell: (adapter) => (
      <div className="data-table__stack">
        <strong>{adapter.displayName ?? adapter.adapterKey}</strong>
        <span className="mono-text muted-text">{adapter.adapterKey}</span>
      </div>
    ),
    accessor: (adapter) => adapter.displayName ?? adapter.adapterKey,
    sortable: true,
  },
  {
    id: 'platform',
    header: 'Platform',
    cell: (adapter) => adapter.platformType,
    accessor: (adapter) => adapter.platformType,
    sortable: true,
  },
  {
    id: 'capabilities',
    header: 'Capabilities',
    cell: (adapter) => (
      <div className="badge-group">
        {adapter.supportedCapabilities.map((cap) => (
          <StatusBadge key={cap} tone="info" compact>
            {cap}
          </StatusBadge>
        ))}
      </div>
    ),
    hideBelow: 768,
  },
  {
    id: 'version',
    header: 'Version',
    align: 'right',
    cell: (adapter) => (
      <span className="mono-text">{adapter.version ?? '—'}</span>
    ),
    hideBelow: 480,
  },
];

export function AdaptersCatalogPage(): ReactElement {
  const query = useAdaptersQuery();

  return (
    <PageLayout
      eyebrow="Platform"
      title="Adapter catalog"
      description="Available integration adapters and their supported capabilities."
    >
      {query.isLoading ? (
        <LoadingState
          title="Loading adapters"
          message="Fetching the adapter registry…"
        />
      ) : query.error ? (
        <ErrorState
          title="Unable to load adapters"
          message={query.error.message}
          action={
            <Button onClick={() => { void query.refetch(); }}>Retry</Button>
          }
        />
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState
          title="No adapters available"
          message="No integration adapters are registered in the system."
        />
      ) : (
        <DataTable
          caption="Available adapters"
          columns={COLUMNS}
          rowKey={(adapter) => adapter.adapterKey}
          rows={query.data ?? []}
        />
      )}
    </PageLayout>
  );
}
