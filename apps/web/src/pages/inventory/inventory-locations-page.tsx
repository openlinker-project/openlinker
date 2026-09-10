/**
 * Inventory Locations Page (#2316 / #3066)
 *
 * The warehouses, stores and third-party sites OpenLinker can source stock
 * from — the operator-facing surface over `inventory_locations` (#2313), of
 * which only the `?status=active&limit=1` probe and the bootstrap POST were
 * previously reachable from the product (#3029/#3063).
 *
 * Follows the `connections-list-page.tsx` cockpit-list composition (filter
 * bar → loading/error/empty → `DataTable`), with the CRUD dialogs mounted on
 * this page rather than routed to separate pages — the `users-page.tsx`
 * inline-dialog precedent, since a location is a small, flat record with no
 * own detail page to justify.
 *
 * @module apps/web/src/pages/inventory
 */
import { useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { Button } from '../../shared/ui/button';
import { Select } from '../../shared/ui/select';
import { EmptyValue } from '../../shared/ui/empty-value';
import { ReadOnlyLock } from '../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../shared/config/demo-mode';
import { useDemoMode } from '../../features/system';
import { usePlatforms } from '../../shared/plugins';
import { resolvePlatformLabel } from '../../features/mappings';
import { ConnectionCell, useConnectionsQuery, type Connection } from '../../features/connections';
import {
  InventoryLocationKindValues,
  KIND_LABEL,
  LocationDialog,
  LocationDeleteDialog,
  useInventoryLocationsQuery,
  useBootstrapLocationsMutation,
  type InventoryLocation,
  type InventoryLocationFilters,
  type InventoryLocationKind,
  type LocationDialogTarget,
} from '../../features/inventory';

const PAGE_SIZE = 25;

function isKnownKind(value: string): value is InventoryLocationKind {
  return (InventoryLocationKindValues as readonly string[]).includes(value);
}

function statusTone(status: InventoryLocation['status']): StatusBadgeTone {
  return status === 'active' ? 'success' : 'neutral';
}

// Guards against a malformed `?page=abc` producing NaN, which would
// otherwise be sent straight through to the API as the `page` filter
// (the `users-page.tsx` `readPageParam` precedent, adapted to this
// endpoint's 1-based paging).
function readPageParam(raw: string | null): number {
  const parsed = Number(raw ?? '1');
  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : 1;
}

// The `users-page.tsx` pager, adapted to 1-based paging and a `total` that
// arrives in the SAME response as the rows (#2316's `PaginatedInventoryLocations`
// — no two-stage-total machinery needed here, unlike `products-list-page.tsx`).
function renderPagination(page: number, setPage: (next: number) => void, total: number): ReactElement | null {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pageCount <= 1) return null;
  return (
    <div className="pagination">
      <span className="text-muted">
        Page {page} of {pageCount} · {total} location{total === 1 ? '' : 's'}
      </span>
      <div className="pagination__actions">
        <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </Button>
        <Button disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function InventoryLocationsPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const demoMode = useDemoMode();
  const platforms = usePlatforms();
  const write = useWriteAccess('inventory-locations:write', demoMode);
  const [dialogTarget, setDialogTarget] = useState<LocationDialogTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InventoryLocation | null>(null);

  const kindParam = searchParams.get('kind') ?? '';
  const kind = isKnownKind(kindParam) ? kindParam : undefined;
  // Default true — soft retirement keeps a row visible by design (#2316), so
  // the toggle narrows to active-only rather than the other way round.
  const showRetired = searchParams.get('retired') !== '0';
  const page = readPageParam(searchParams.get('page'));

  const filters: InventoryLocationFilters = {
    kind,
    status: showRetired ? undefined : 'active',
  };

  const query = useInventoryLocationsQuery(filters, { page, limit: PAGE_SIZE });
  const connectionsQuery = useConnectionsQuery();
  const bootstrapMutation = useBootstrapLocationsMutation();

  const connectionById = useMemo(() => {
    const map = new Map<string, Connection>();
    (connectionsQuery.data ?? []).forEach((c) => map.set(c.id, c));
    return map;
  }, [connectionsQuery.data]);

  function handleFilterChange(key: string, value: string): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      // A changed filter can shrink the result set out from under the
      // current page, so land back on page 1 rather than risk a page
      // number the new filter has no rows for.
      next.delete('page');
      return next;
    });
  }

  function clearFilters(): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('kind');
      next.delete('retired');
      next.delete('page');
      return next;
    });
  }

  function setPage(nextPage: number): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (nextPage <= 1) {
        next.delete('page');
      } else {
        next.set('page', String(nextPage));
      }
      return next;
    });
  }

  const filtersActive = Boolean(kind) || !showRetired;

  const columns = useMemo<DataTableColumn<InventoryLocation>[]>(
    () => [
      {
        id: 'location',
        header: 'Location',
        cell: (location) => (
          <div className="data-table__stack">
            <strong>{location.name}</strong>
            <span className="muted-text mono-text">
              {location.code}
              {location.externalRef ? ` · ${location.externalRef}` : ''}
            </span>
          </div>
        ),
        accessor: (location) => location.name,
        sortable: true,
      },
      {
        id: 'kind',
        header: 'Kind',
        cell: (location) => KIND_LABEL[location.kind],
        accessor: (location) => location.kind,
        sortable: true,
      },
      {
        id: 'geo',
        header: 'Country / postcode',
        cell: (location): ReactElement => {
          const geo = [location.countryIso2, location.postcode].filter(Boolean).join(' · ');
          return geo ? <span className="mono-text">{geo}</span> : <EmptyValue label="No location set" />;
        },
        hideBelow: 1024,
      },
      {
        id: 'owner',
        header: 'Owning connection',
        cell: (location): ReactElement => {
          if (!location.ownerConnectionId) {
            return <EmptyValue label="No owning connection" />;
          }
          const connection = connectionById.get(location.ownerConnectionId) ?? null;
          return (
            <ConnectionCell
              connectionId={location.ownerConnectionId}
              connection={connection}
              loading={connectionsQuery.isLoading}
              adornment={
                connection ? (
                  <span className="channel-pill" data-channel={connection.platformType}>
                    {resolvePlatformLabel(platforms, connection.platformType)}
                  </span>
                ) : null
              }
            />
          );
        },
        hideBelow: 1024,
      },
      {
        id: 'status',
        header: 'Status',
        cell: (location) => (
          <StatusBadge tone={statusTone(location.status)}>{location.status}</StatusBadge>
        ),
        accessor: (location) => location.status,
        sortable: true,
      },
      {
        id: 'actions',
        header: '',
        cell: (location) =>
          write.visible ? (
            <div className="table-actions">
              <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                <Button
                  className="button--sm"
                  tone="secondary"
                  disabled={write.demoReadOnly}
                  onClick={() => setDialogTarget({ mode: 'edit', location })}
                >
                  Edit
                </Button>
              </ReadOnlyLock>
              <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                <Button
                  className="button--sm"
                  tone="danger"
                  disabled={write.demoReadOnly}
                  onClick={() => setDeleteTarget(location)}
                >
                  Delete
                </Button>
              </ReadOnlyLock>
            </div>
          ) : null,
      },
    ],
    [connectionById, connectionsQuery.isLoading, platforms, write.visible, write.demoReadOnly],
  );

  return (
    <PageLayout
      eyebrow="Fulfilment routing"
      title="Inventory locations"
      description="The warehouses, stores and third-party sites OpenLinker can source stock from. A location isn't authority over stock — it's the place sourcing rules pick between. Delete is refused while any stock still points here; retire it instead."
      actions={
        write.visible ? (
          <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
            <Button disabled={write.demoReadOnly} onClick={() => setDialogTarget({ mode: 'create' })}>
              + Add location
            </Button>
          </ReadOnlyLock>
        ) : null
      }
    >
      <div className="toolbar">
        <div className="toolbar__group">
          <Select
            aria-label="Filter by kind"
            value={kind ?? ''}
            onChange={(e) => { handleFilterChange('kind', e.target.value); }}
          >
            <option value="">All kinds</option>
            {InventoryLocationKindValues.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
          <label className="toolbar__checkbox-label">
            <input
              type="checkbox"
              name="showRetired"
              checked={showRetired}
              onChange={(e) => { handleFilterChange('retired', e.target.checked ? '' : '0'); }}
            />
            Show retired
          </label>
        </div>
      </div>

      {query.isLoading ? (
        <DataTableSkeleton columns={columns.length} rows={5} />
      ) : query.error ? (
        <ErrorState
          title="Couldn't load locations"
          message={query.error.message}
          action={<Button onClick={() => { void query.refetch(); }}>Retry</Button>}
        />
      ) : (query.data?.items ?? []).length === 0 ? (
        <EmptyState
          title={filtersActive ? 'No locations match this filter' : 'Routing has nowhere to source stock from'}
          message={
            filtersActive
              ? 'No locations match the current filters.'
              : 'Zero locations exist — every order is currently unfulfillable. Mint the first one, or add your own.'
          }
          action={
            filtersActive ? (
              <Button onClick={clearFilters}>Clear filters</Button>
            ) : write.visible ? (
              <div className="table-actions">
                <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                  <Button
                    disabled={write.demoReadOnly || bootstrapMutation.isPending}
                    onClick={() => bootstrapMutation.mutate()}
                  >
                    Create first location
                  </Button>
                </ReadOnlyLock>
                <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                  <Button
                    tone="secondary"
                    disabled={write.demoReadOnly}
                    onClick={() => setDialogTarget({ mode: 'create' })}
                  >
                    + Add manually
                  </Button>
                </ReadOnlyLock>
              </div>
            ) : null
          }
        />
      ) : (
        <>
          <DataTable
            caption="Inventory locations"
            columns={columns}
            rowKey={(location) => location.id}
            rows={[...(query.data?.items ?? [])]}
            cardView={{
              title: (location) => location.name,
              subtitle: (location) => location.code,
              meta: (location) => (
                <StatusBadge tone={statusTone(location.status)} compact>
                  {location.status}
                </StatusBadge>
              ),
            }}
          />
          {renderPagination(page, setPage, query.data?.total ?? 0)}
        </>
      )}

      <LocationDialog target={dialogTarget} onClose={() => setDialogTarget(null)} />
      <LocationDeleteDialog location={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </PageLayout>
  );
}
