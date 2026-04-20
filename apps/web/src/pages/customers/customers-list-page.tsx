import { useState, type ReactElement, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { useTableSort } from '../../shared/ui/use-table-sort';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import { useCustomersQuery } from '../../features/customers/hooks/use-customers-query';
import type { CustomerFilters, CustomerProjection } from '../../features/customers/api/customers.types';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const COLUMNS: DataTableColumn<CustomerProjection>[] = [
  {
    id: 'internalCustomerId',
    header: 'Customer ID',
    cell: (c): ReactNode => <span className="mono-text">{c.internalCustomerId}</span>,
  },
  {
    id: 'emailHash',
    header: 'Email Hash',
    cell: (c): ReactNode => <span className="mono-text">{c.emailHash}</span>,
    hideBelow: 1024,
  },
  {
    id: 'name',
    header: 'Name',
    cell: (c): ReactNode => {
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
      return name ? <span>{name}</span> : <span className="text-muted">—</span>;
    },
    accessor: (c) => [c.firstName, c.lastName].filter(Boolean).join(' '),
    sortable: true,
  },
  {
    id: 'lastSourceConnectionId',
    header: 'Last Source',
    cell: (c): ReactNode =>
      c.lastSourceConnectionId ? (
        <span className="mono-text">{c.lastSourceConnectionId}</span>
      ) : (
        <span className="text-muted">—</span>
      ),
    hideBelow: 768,
  },
  {
    id: 'lastSeenAt',
    header: 'Last Seen',
    cell: (c): ReactNode => <TimeDisplay iso={c.lastSeenAt} format="date" />,
    accessor: (c) => c.lastSeenAt,
    sortable: true,
  },
];

export function CustomersListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sort, setSort } = useTableSort([{ id: 'lastSeenAt', desc: true }]);

  const urlSearch = searchParams.get('search') ?? '';
  const urlConnectionId = searchParams.get('lastSourceConnectionId') ?? '';
  const offset = Number(searchParams.get('offset') ?? '0');

  const [searchInput, setSearchInput] = useState(urlSearch);
  const [connectionIdInput, setConnectionIdInput] = useState(urlConnectionId);
  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  const debouncedConnectionId = useDebouncedValue(connectionIdInput, SEARCH_DEBOUNCE_MS);

  const filters: CustomerFilters = {
    search: debouncedSearch || undefined,
    lastSourceConnectionId: debouncedConnectionId || undefined,
  };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useCustomersQuery(filters, pagination);

  function handleFilterChange(key: string, value: string): void {
    if (key === 'search') setSearchInput(value);
    if (key === 'lastSourceConnectionId') setConnectionIdInput(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      next.delete('offset');
      return next;
    });
  }

  function setOffset(next: number): void {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === 0) {
        p.delete('offset');
      } else {
        p.set('offset', String(next));
      }
      return p;
    });
  }

  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <PageLayout
      eyebrow="Operations"
      title="Customers"
      description="Customer identity projections — browse resolved identities and address history."
    >
      <div className="toolbar toolbar--compact">
        <input
          aria-label="Search customers"
          placeholder="Search by email or name…"
          value={searchInput}
          onChange={(e) => { handleFilterChange('search', e.target.value); }}
        />
        <input
          aria-label="Filter by source connection ID"
          placeholder="Source connection ID…"
          value={connectionIdInput}
          onChange={(e) => { handleFilterChange('lastSourceConnectionId', e.target.value); }}
        />
      </div>

      {query.isLoading ? (
        <LoadingState
          liveRegion="off"
          title="Loading customers"
          message="Fetching customer projection data…"
        />
      ) : query.error ? (
        <ErrorState
          title="Unable to load customers"
          message={query.error.message}
          action={
            <Button onClick={() => { void query.refetch(); }}>Retry</Button>
          }
        />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          liveRegion="off"
          title="No customers found"
          message={
            debouncedSearch || debouncedConnectionId
              ? 'No customer projections match the current filters.'
              : 'No customer projections have been recorded yet.'
          }
        />
      ) : (
        <>
          <DataTable
            caption="Customer projections"
            columns={COLUMNS}
            rows={query.data?.items ?? []}
            rowKey={(c) => c.internalCustomerId}
            rowHref={(c) => c.internalCustomerId}
            sort={sort}
            onSortChange={setSort}
            cardView={{
              title: (c) => c.internalCustomerId,
              subtitle: (c) => [c.firstName, c.lastName].filter(Boolean).join(' ') || c.emailHash,
              meta: (c) => <TimeDisplay iso={c.lastSeenAt} format="date" />,
            }}
          />

          <div className="pagination">
            <span className="text-muted">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div className="pagination__actions">
              <Button disabled={!hasPrev} onClick={() => { setOffset(offset - PAGE_SIZE); }}>
                Previous
              </Button>
              <Button disabled={!hasNext} onClick={() => { setOffset(offset + PAGE_SIZE); }}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}
