import { useState, type ReactElement, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { useTableSort } from '../../shared/ui/use-table-sort';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { Input } from '../../shared/ui/input';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import { useListingsQuery } from '../../features/listings/hooks/use-listings-query';
import { OfferCreationLauncher } from '../../features/listings/components/OfferCreationLauncher';
import { OfferCreationTracker } from '../../features/listings/components/OfferCreationTracker';
import {
  ShopPublishLauncher,
  selectShopPublishConnections,
} from '../../features/listings/components/ShopPublishLauncher';
import { useConnectionsQuery } from '../../features/connections';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { useDemoMode } from '../../features/system';
import type {
  CreateOfferRequest,
  ListingsFilters,
  OfferCreationStatusResponse,
  OfferMapping,
} from '../../features/listings/api/listings.types';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const COLUMNS: DataTableColumn<OfferMapping>[] = [
  {
    id: 'externalId',
    header: 'External ID',
    cell: (m): ReactNode => (
      <span className="mono-text" title={m.externalId}>
        {m.externalId}
      </span>
    ),
  },
  {
    id: 'internalId',
    header: 'Internal ID',
    cell: (m): ReactNode => <span className="mono-text">{m.internalId}</span>,
    hideBelow: 1024,
  },
  {
    id: 'platformType',
    header: 'Platform',
    cell: (m): ReactNode => <span className="mono-text">{m.platformType}</span>,
    accessor: (m): string => m.platformType,
    sortable: true,
  },
  {
    id: 'entityType',
    header: 'Entity Type',
    cell: (m): ReactNode => <span className="mono-text">{m.entityType}</span>,
    hideBelow: 768,
  },
  {
    id: 'connectionId',
    header: 'Connection',
    cell: (m): ReactNode => <span className="mono-text">{m.connectionId}</span>,
    hideBelow: 768,
  },
  {
    id: 'createdAt',
    header: 'Created',
    cell: (m): ReactNode => <TimeDisplay iso={m.createdAt} format="date" />,
    accessor: (m): string => m.createdAt,
    sortable: true,
  },
];

export function ListingsListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sort, setSort } = useTableSort([{ id: 'createdAt', desc: true }]);

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

  function clearFilters(): void {
    setSearchInput('');
    setConnectionIdInput('');
    setPlatformTypeInput('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('search');
      next.delete('connectionId');
      next.delete('platformType');
      next.delete('offset');
      return next;
    });
  }

  const hasFilters = !!(debouncedSearch || debouncedConnectionId || debouncedPlatformType);
  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  const trackedRecordId = searchParams.get('offerCreationRecordId') ?? '';
  const trackedConnectionId = searchParams.get('trackedConnectionId') ?? '';
  const hasTracker = Boolean(trackedRecordId && trackedConnectionId);

  const connectionsQuery = useConnectionsQuery();
  const shopPublishConnections = selectShopPublishConnections(connectionsQuery.data ?? []);
  const canPublishToShop = shopPublishConnections.length > 0;
  const demoMode = useDemoMode();
  // "Create offer" and "Publish to shop" both open a wizard first — visible
  // (enabled) for a demo viewer per the useWriteAccess + ReadOnlyLock pattern
  // (#1615/#1613); the wizards themselves gate their own final submit (#1663).
  const write = useWriteAccess('listings:write', demoMode);

  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isShopPublishOpen, setIsShopPublishOpen] = useState(false);
  // Retry-path hints passed to the wizard when the operator clicks Retry
  // on a failed OfferCreationTracker. These mirror the record's snapshot
  // so the wizard can pre-fill on open and land directly on Step 2.
  const [retryInitialValues, setRetryInitialValues] = useState<CreateOfferRequest | undefined>(
    undefined,
  );
  const [retryDefaultConnectionId, setRetryDefaultConnectionId] = useState<string | undefined>(
    undefined,
  );

  function dismissTracker(): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('offerCreationRecordId');
      next.delete('trackedConnectionId');
      return next;
    });
  }

  function handleOfferSubmitted(offerCreationRecordId: string, connectionId: string): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('offerCreationRecordId', offerCreationRecordId);
      next.set('trackedConnectionId', connectionId);
      return next;
    });
  }

  function handleRetry(record: OfferCreationStatusResponse): void {
    if (!record.request) return;
    setRetryInitialValues(record.request);
    setRetryDefaultConnectionId(record.connectionId);
    setIsWizardOpen(true);
    // Drop the old tracker from the URL — the new submit will re-install
    // a fresh tracker for the new OfferCreationRecord via onSubmitted.
    dismissTracker();
  }

  function closeWizard(): void {
    setIsWizardOpen(false);
    setRetryInitialValues(undefined);
    setRetryDefaultConnectionId(undefined);
  }

  return (
    <PageLayout
      eyebrow="Operations"
      title="Listings"
      description="Offer mapping workbench — browse offer-to-variant identifier mappings across platforms."
      actions={
        write.visible ? (
          <>
            <Button onClick={() => setIsWizardOpen(true)}>Create offer</Button>
            {canPublishToShop ? (
              <Button tone="secondary" onClick={() => setIsShopPublishOpen(true)}>
                Publish to shop
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {hasTracker ? (
        <OfferCreationTracker
          connectionId={trackedConnectionId}
          offerCreationRecordId={trackedRecordId}
          onDismiss={dismissTracker}
          onRetry={handleRetry}
        />
      ) : null}

      <div className="toolbar toolbar--compact">
        <Input
          aria-label="Search by external ID"
          placeholder="External ID…"
          value={searchInput}
          onChange={(e) => {
            handleFilterChange('search', e.target.value);
          }}
        />
        <Input
          aria-label="Filter by connection ID"
          placeholder="Connection ID…"
          value={connectionIdInput}
          onChange={(e) => {
            handleFilterChange('connectionId', e.target.value);
          }}
        />
        <Input
          aria-label="Filter by platform type"
          placeholder="Platform type…"
          value={platformTypeInput}
          onChange={(e) => {
            handleFilterChange('platformType', e.target.value);
          }}
        />
      </div>

      {query.isLoading ? (
        <DataTableSkeleton columns={COLUMNS} />
      ) : query.error ? (
        <ErrorState
          title="Unable to load listings"
          message={query.error.message}
          action={
            <Button
              onClick={() => {
                void query.refetch();
              }}
            >
              Retry
            </Button>
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
          action={
            hasFilters ? (
              <Button onClick={clearFilters}>Clear filters</Button>
            ) : (
              <Link className="button button--primary" to="/connections">
                Manage connections
              </Link>
            )
          }
        />
      ) : (
        <>
          <DataTable
            caption="Offer mappings"
            columns={COLUMNS}
            rows={query.data?.items ?? []}
            rowKey={(m) => m.id}
            rowHref={(m) => m.id}
            sort={sort}
            onSortChange={setSort}
            cardView={{
              title: (m) => m.externalId,
              subtitle: (m) => `${m.platformType} · ${m.entityType}`,
              meta: (m) => <TimeDisplay iso={m.createdAt} format="date" />,
            }}
          />

          <div className="pagination">
            <span className="text-muted">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div className="pagination__actions">
              <Button
                disabled={!hasPrev}
                onClick={() => {
                  setOffset(offset - PAGE_SIZE);
                }}
              >
                Previous
              </Button>
              <Button
                disabled={!hasNext}
                onClick={() => {
                  setOffset(offset + PAGE_SIZE);
                }}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <OfferCreationLauncher
        isOpen={isWizardOpen}
        onClose={closeWizard}
        defaultConnectionId={retryDefaultConnectionId ?? (debouncedConnectionId || undefined)}
        initialValues={retryInitialValues}
        onSubmitted={handleOfferSubmitted}
      />

      <ShopPublishLauncher open={isShopPublishOpen} onOpenChange={setIsShopPublishOpen} />
    </PageLayout>
  );
}
