import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { useAdaptersQuery } from '../../features/adapters/hooks/use-adapters-query';
import type { AdapterSummary } from '../../features/adapters/api/adapters.types';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { ErrorState, LoadingState, EmptyState } from '../../shared/ui/feedback-state';
import { StatusBadge } from '../../shared/ui/status-badge';
import { Button } from '../../shared/ui/button';
import { PageLayout } from '../../shared/ui/page-layout';
import { bucketCount, captureDemoEvent } from '../../features/demo';
import { useMessages, type Messages, type ResolvedCopy } from '../../shared/i18n';
import { describeApiError } from '../../shared/api/describe-api-error';

type PageCopy = ResolvedCopy<Messages['adapters']>['adaptersCatalogPage'];

function buildColumns(copy: PageCopy): DataTableColumn<AdapterSummary>[] {
  return [
  {
    id: 'adapter',
    header: copy.columns.adapter,
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
    header: copy.columns.platform,
    cell: (adapter) => adapter.platformType,
    accessor: (adapter) => adapter.platformType,
    sortable: true,
  },
  {
    id: 'capabilities',
    header: copy.columns.capabilities,
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
    header: copy.columns.version,
    cell: (adapter) => (
      <span className="mono-text">{adapter.version ?? copy.noVersion}</span>
    ),
    hideBelow: 480,
  },
  ];
}

export function AdaptersCatalogPage(): ReactElement {
  const query = useAdaptersQuery();
  const copy = useMessages('adapters').adaptersCatalogPage;
  const common = useMessages('ui').common;
  const columns = useMemo(() => buildColumns(copy), [copy]);

  // Fire once per successful load, not on every refetch — demo-mode
  // analytics only (#1789), no-op elsewhere.
  const hasFiredViewedRef = useRef(false);
  useEffect(() => {
    if (query.data && !hasFiredViewedRef.current) {
      hasFiredViewedRef.current = true;
      captureDemoEvent('demo_adapters_catalog_viewed', {
        adapterCountBucket: bucketCount(query.data.length),
      });
    }
  }, [query.data]);

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
    >
      {query.isLoading ? (
        <LoadingState
          title={copy.loading.title}
          message={copy.loading.message}
        />
      ) : query.error ? (
        <ErrorState
          title={copy.error.title}
          message={describeApiError(query.error, 'adapters')}
          action={
            <Button onClick={() => { void query.refetch(); }}>{common.retry}</Button>
          }
        />
      ) : (query.data ?? []).length === 0 ? (
        // No action: adapters are system-registered at build time; operators cannot add them from the UI.
        <EmptyState
          title={copy.empty.title}
          message={copy.empty.message}
        />
      ) : (
        <DataTable
          caption={copy.caption}
          columns={columns}
          rowKey={(adapter) => adapter.adapterKey}
          rows={query.data ?? []}
        />
      )}
    </PageLayout>
  );
}
