import { useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import { useListingsQuery } from '../../features/listings/hooks/use-listings-query';
import type { ListingsFilters, OfferMapping } from '../../features/listings/api/listings.types';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const COLUMNS: DataTableColumn<OfferMapping>[] = [
  {
    id: 'externalId',
    header: 'External ID',
    cell: (m) => <span className="mono-text">{m.externalId}</span>,
  },
  {
    id: 'internalId',
    header: 'Internal ID',
    cell: (m) => <span className="mono-text">{m.internalId}</span>,
  },
  {
    id: 'platformType',
    header: 'Platform',
    cell: (m) => <span className="mono-text">{m.platformType}</span>,
  },
  {
    id: 'entityType',
    header: 'Entity Type',
    cell: (m) => <span className="mono-text">{m.entityType}</span>,
  },
  {
    id: 'connectionId',
    header: 'Connection',
    cell: (m) => <span className="mono-text">{m.connectionId}</span>,
  },
  {
    id: 'createdAt',
    header: 'Created',
    cell: (m) => new Date(m.createdAt).toLocaleDateString(),
  },
  {
    id: 'detail',
    header: '',
    cell: (m) => (
      <Link to={m.id} className="button button--ghost button--compact">
        View
      </Link>
    ),
  },
];

export function ListingsListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();

  const urlSearch = searchParams.get('search') ?? '';
  const urlConnectionId = searchParams.get('connectionId') ?? '';
  const urlPlatformType = searchParams.get('platformType') ?? '';
  const offset = Number(searchParams.get('offset') ?? '0');

  const [searchInput, setSearchInput] = useState(urlSearch);
  const [connectionIdInput, setConnectionIdInput] = useState(urlConnectionId);
  const [platformTypeInput, setPlatformTypeInput] = useState(urlPlatformType);

  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  const debouncedConnectionId = useDebouncedValue(connectionIdInput, SEARCH_DEBOUNCE_MS);
  const debouncedPlatformType = useDebouncedValue(platformTypeInput, SEARCH_DEBOUNCE_MS);

  const filters: ListingsFilters = {
    search: debouncedSearch || undefined,
    connectionId: debouncedConnectionId || undefined,
    platformType: debouncedPlatformType || undefined,
  };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useListingsQuery(filters, pagination);

  function handleFilterChange(key: string, value: string): void {
    if (key === 'search') setSearchInput(value);
    if (key === 'connectionId') setConnectionIdInput(value);
    if (key === 'platformType') setPlatformTypeInput(value);
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

  const hasFilters = !!(debouncedSearch || debouncedConnectionId || debouncedPlatformType);
  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <PageLayout
      eyebrow="Operations"
      title="Listings"
      description="Offer mapping workbench — browse offer-to-variant identifier mappings across platforms."
    >
      <div className="toolbar" style={{ gap: '0.5rem' }}>
        <input
          aria-label="Search by external ID"
          placeholder="External ID…"
          value={searchInput}
          onChange={(e) => { handleFilterChange('search', e.target.value); }}
        />
        <input
          aria-label="Filter by connection ID"
          placeholder="Connection ID…"
          value={connectionIdInput}
          onChange={(e) => { handleFilterChange('connectionId', e.target.value); }}
        />
        <input
          aria-label="Filter by platform type"
          placeholder="Platform type…"
          value={platformTypeInput}
          onChange={(e) => { handleFilterChange('platformType', e.target.value); }}
        />
      </div>

      {query.isLoading ? (
        <LoadingState
          liveRegion="off"
          title="Loading listings"
          message="Fetching offer mapping data…"
        />
      ) : query.error ? (
        <ErrorState
          title="Unable to load listings"
          message={query.error.message}
          action={
            <Button onClick={() => { void query.refetch(); }}>Retry</Button>
          }
        />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          liveRegion="off"
          title="No offer mappings found"
          message={
            hasFilters
              ? 'No offer mappings match the current filters.'
              : 'No offer mappings have been synced yet.'
          }
        />
      ) : (
        <>
          <DataTable
            caption="Offer mappings"
            columns={COLUMNS}
            rows={query.data?.items ?? []}
            rowKey={(m) => m.id}
          />

          <div className="toolbar" style={{ justifyContent: 'space-between' }}>
            <span className="text-muted">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
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
