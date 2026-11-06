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
import { getMessages, interpolate, useMessages, usePlural, type PluralFn } from '../../shared/i18n';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { Button } from '../../shared/ui/button';
import { Select } from '../../shared/ui/select';
import { EmptyValue } from '../../shared/ui/empty-value';
import { ReadOnlyLock } from '../../shared/ui/read-only-lock';
import { useToast } from '../../shared/ui/toast-provider';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { demoReadOnlyActionMessage } from '../../shared/config/demo-mode';
import { useDemoMode } from '../../features/system';
import { usePlatforms } from '../../shared/plugins';
import { resolvePlatformLabel, resolvePlatformShortLabel } from '../../features/mappings';
import {
  ConnectionCell,
  readConnectionEnvironment,
  useConnectionsQuery,
  type Connection,
} from '../../features/connections';
import {
  InventoryLocationKindValues,
  KIND_LABEL,
  LocationDialog,
  LocationDeleteDialog,
  useInventoryLocationsQuery,
  useBootstrapLocationsMutation,
  useUpdateInventoryLocationMutation,
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

// #3135 review: the wire value `inactive` was rendered verbatim, while
// every other badge surface in this app renders operator copy and the
// "Show retired" toggle beside it already calls the same state "retired".
const STATUS_LABEL: Readonly<Record<InventoryLocation['status'], string>> = {
  get active(): string {
    return getMessages('inventory').inventoryLocationsPage.statuses.active;
  },
  get inactive(): string {
    return getMessages('inventory').inventoryLocationsPage.statuses.inactive;
  },
};

type LocationsPageCopy = ReturnType<typeof useMessages<'inventory'>>['inventoryLocationsPage'];

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
function renderPagination(
  copy: LocationsPageCopy,
  plural: PluralFn,
  page: number,
  setPage: (next: number) => void,
  total: number,
): ReactElement | null {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pageCount <= 1) return null;
  return (
    <div className="pagination">
      <span className="text-muted">
        {plural(total, copy.pagination.summary, { page, pages: pageCount })}
      </span>
      <div className="pagination__actions">
        <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          {copy.pagination.previous}
        </Button>
        <Button disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
          {copy.pagination.next}
        </Button>
      </div>
    </div>
  );
}

export function InventoryLocationsPage(): ReactElement {
  const copy = useMessages('inventory').inventoryLocationsPage;
  const plural = usePlural();
  const [searchParams, setSearchParams] = useSearchParams();
  const demoMode = useDemoMode();
  const platforms = usePlatforms();
  const { showToast } = useToast();
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
  const reactivateMutation = useUpdateInventoryLocationMutation();
  const retireMutation = useUpdateInventoryLocationMutation();

  const connectionById = useMemo(() => {
    const map = new Map<string, Connection>();
    (connectionsQuery.data ?? []).forEach((c) => map.set(c.id, c));
    return map;
  }, [connectionsQuery.data]);

  // Mirrors `users-page.tsx`'s handleReactivate — a direct, single-click
  // action with no confirm dialog (the mockup's `reactivateLocation`):
  // reactivating is reversible and non-destructive, unlike delete.
  async function handleReactivate(location: InventoryLocation): Promise<void> {
    try {
      await reactivateMutation.mutateAsync({ id: location.id, patch: { status: 'active' } });
      showToast({
        tone: 'success',
        title: interpolate(copy.toasts.reactivatedTitle, { name: location.name }),
        description: copy.toasts.reactivatedDescription,
      });
    } catch {
      showToast({ tone: 'error', title: copy.toasts.reactivateFailed, description: copy.toasts.tryAgain });
    }
  }

  // Direct row-level counterpart to handleReactivate (the mockup's
  // `retireLocation`) — no confirm dialog, because retiring never deletes
  // anything and Reactivate undoes it in one click. The delete-confirm
  // dialog's own "Retire instead" 409 fallback stays as a defensive path for
  // an operator who reaches for Delete first; this is the direct one.
  async function handleRetire(location: InventoryLocation): Promise<void> {
    try {
      await retireMutation.mutateAsync({ id: location.id, patch: { status: 'inactive' } });
      showToast({
        tone: 'success',
        title: interpolate(copy.toasts.retiredTitle, { name: location.name }),
        // #3198 review: reversibility is the stated reason this action has no
        // confirm step, and the mockup says it out loud, so the operator was
        // the one party never told. The earlier #3068 note that removed this
        // clause was correct at the time - nothing then exposed reactivation
        // - and expired the moment `handleReactivate` above shipped.
        description: copy.toasts.retiredDescription,
      });
    } catch {
      showToast({ tone: 'error', title: copy.toasts.retireFailed, description: copy.toasts.tryAgain });
    }
  }

  // #3198 review: `mutate()` swallows the rejection, so a failed bootstrap
  // left the operator on an unchanged empty state with no toast and no
  // banner - on the single action that zero state exists to offer. The other
  // consumer of this same hook (`router-readiness-panel.tsx`) already reports
  // the failure; two consumers of one hook must not disagree about that.
  // The server message is carried through rather than flattened to "try
  // again" because the reachable failures are distinguishable and actionable
  // (a non-admin session answers 403, #2316).
  //
  // Deliberately no success toast: success replaces this zero state with the
  // created row, and a concurrent re-run reports its code in `existingCodes`
  // having created nothing (#2407) - announcing that as a creation would be
  // a positive claim this surface cannot support.
  async function handleBootstrap(): Promise<void> {
    try {
      await bootstrapMutation.mutateAsync();
    } catch (error) {
      showToast({
        tone: 'error',
        title: copy.toasts.bootstrapFailed,
        description: error instanceof Error ? error.message : copy.toasts.tryAgain,
      });
    }
  }

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
  // Distinct from `filtersActive`: an empty current page with a non-zero
  // total means the PAGE is wrong, not the filters (e.g. page 2 emptied by
  // a delete elsewhere, or a hand-edited `?page=99`). Rendering the
  // pre-bootstrap "zero locations" empty state there would falsely tell the
  // operator nothing exists (tech-review finding).
  const pageOutOfRange = page > 1 && (query.data?.total ?? 0) > 0 && (query.data?.items.length ?? 0) === 0;

  // No column declares `sortable`/`accessor`: `ListLocationsQueryDto` has no
  // sort param (the backend always orders by `code`), and this list is
  // paginated. `DataTable` falls back to CLIENT sort with neither `sort` nor
  // `onSortChange` supplied, which would only reorder the visible page —
  // page 2's "sorted" rows wouldn't compose with page 1's, so the table
  // would look globally sorted while lying about it (tech-review finding).
  const columns = useMemo<DataTableColumn<InventoryLocation>[]>(
    () => [
      {
        id: 'location',
        header: copy.columns.location,
        cell: (location) => (
          <div className="data-table__stack">
            <strong>{location.name}</strong>
            <span className="muted-text mono-text">
              {location.code}
              {location.externalRef ? ` · ${location.externalRef}` : ''}
            </span>
          </div>
        ),
      },
      {
        id: 'kind',
        header: copy.columns.kind,
        cell: (location) => KIND_LABEL[location.kind],
      },
      {
        id: 'geo',
        header: copy.columns.geo,
        cell: (location): ReactElement => {
          const geo = [location.countryIso2, location.postcode].filter(Boolean).join(' · ');
          return geo ? <span className="mono-text">{geo}</span> : <EmptyValue label={copy.columns.noGeo} />;
        },
        hideBelow: 1024,
      },
      {
        id: 'owner',
        header: copy.columns.owner,
        cell: (location): ReactElement => {
          if (!location.ownerConnectionId) {
            return <EmptyValue label={copy.columns.noOwner} />;
          }
          const connection = connectionById.get(location.ownerConnectionId) ?? null;
          return (
            <ConnectionCell
              connectionId={location.ownerConnectionId}
              connection={connection}
              loading={connectionsQuery.isLoading}
              channel={
                connection
                  ? {
                      platformType: connection.platformType,
                      label: resolvePlatformLabel(platforms, connection.platformType),
                      shortLabel: resolvePlatformShortLabel(platforms, connection.platformType),
                      environment: readConnectionEnvironment(connection.config),
                    }
                  : undefined
              }
            />
          );
        },
        hideBelow: 1024,
      },
      {
        id: 'status',
        header: copy.columns.status,
        cell: (location) => (
          <StatusBadge tone={statusTone(location.status)} className="loc-status-badge">
            {STATUS_LABEL[location.status]}
          </StatusBadge>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: (location) =>
          write.visible ? (
            <div className="table-actions">
              <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
                <Button
                  className="button--sm"
                  tone="secondary"
                  disabled={write.demoReadOnly}
                  onClick={() => setDialogTarget({ mode: 'edit', location })}
                >
                  {copy.actions.edit}
                </Button>
              </ReadOnlyLock>
              {location.status === 'active' ? (
                <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
                  <Button
                    className="button--sm loc-status-action"
                    tone="secondary"
                    disabled={write.demoReadOnly || retireMutation.isPending}
                    onClick={() => { void handleRetire(location); }}
                  >
                    {copy.actions.retire}
                  </Button>
                </ReadOnlyLock>
              ) : (
                <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
                  <Button
                    className="button--sm loc-status-action"
                    tone="secondary"
                    disabled={write.demoReadOnly || reactivateMutation.isPending}
                    onClick={() => { void handleReactivate(location); }}
                  >
                    {copy.actions.reactivate}
                  </Button>
                </ReadOnlyLock>
              )}
              <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
                <Button
                  className="button--sm"
                  tone="danger"
                  disabled={write.demoReadOnly}
                  onClick={() => setDeleteTarget(location)}
                >
                  {copy.actions.delete}
                </Button>
              </ReadOnlyLock>
            </div>
          ) : null,
      },
    ],
    [
      connectionById,
      connectionsQuery.isLoading,
      platforms,
      write.visible,
      write.demoReadOnly,
      reactivateMutation.isPending,
      retireMutation.isPending,
      copy,
    ],
  );

  return (
    <PageLayout
      backTo={{ to: '/settings', label: copy.back }}
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      actions={
        write.visible ? (
          <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
            <Button disabled={write.demoReadOnly} onClick={() => setDialogTarget({ mode: 'create' })}>
              {copy.addLocation}
            </Button>
          </ReadOnlyLock>
        ) : null
      }
    >
      <div className="toolbar">
        <div className="toolbar__group">
          <Select
            aria-label={copy.filterKind}
            value={kind ?? ''}
            onChange={(e) => { handleFilterChange('kind', e.target.value); }}
          >
            <option value="">{copy.allKinds}</option>
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
            {copy.showRetired}
          </label>
        </div>
      </div>

      {query.isLoading ? (
        <DataTableSkeleton columns={columns.length} rows={5} />
      ) : query.error ? (
        <ErrorState
          title={copy.errorTitle}
          message={query.error.message}
          action={<Button onClick={() => { void query.refetch(); }}>{copy.retry}</Button>}
        />
      ) : (query.data?.items ?? []).length === 0 ? (
        <EmptyState
          title={
            pageOutOfRange
              ? copy.empty.pageGoneTitle
              : filtersActive
                ? copy.empty.filteredTitle
                : copy.empty.title
          }
          message={
            pageOutOfRange
              ? interpolate(copy.empty.pageGoneMessage, { total: query.data?.total ?? 0, page })
              : filtersActive
                ? copy.empty.filteredMessage
                // #3135 review: routing is opt-in (#2407) and ConnectionService
                // refuses the false->true transition while zero locations
                // exist, so a zero-location install either has routing off
                // (orders fulfil fine today) or could never have enabled it —
                // "every order is unfulfillable" was false in both directions.
                : copy.empty.message
          }
          action={
            pageOutOfRange ? (
              <Button onClick={() => setPage(1)}>{copy.empty.backToFirst}</Button>
            ) : filtersActive ? (
              <Button onClick={clearFilters}>{copy.empty.clearFilters}</Button>
            ) : write.visible ? (
              <div className="table-actions">
                <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
                  <Button
                    disabled={write.demoReadOnly || bootstrapMutation.isPending}
                    onClick={() => void handleBootstrap()}
                  >
                    {copy.empty.createFirst}
                  </Button>
                </ReadOnlyLock>
                <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
                  <Button
                    tone="secondary"
                    disabled={write.demoReadOnly}
                    onClick={() => setDialogTarget({ mode: 'create' })}
                  >
                    {copy.empty.addManually}
                  </Button>
                </ReadOnlyLock>
              </div>
            ) : null
          }
        />
      ) : (
        <>
          <DataTable
            caption={copy.caption}
            columns={columns}
            rowKey={(location) => location.id}
            rows={[...(query.data?.items ?? [])]}
            cardView={{
              title: (location) => location.name,
              subtitle: (location) => location.code,
              meta: (location) => (
                <StatusBadge tone={statusTone(location.status)} compact>
                  {STATUS_LABEL[location.status]}
                </StatusBadge>
              ),
            }}
          />
          {renderPagination(copy, plural, page, setPage, query.data?.total ?? 0)}
        </>
      )}

      <LocationDialog target={dialogTarget} onClose={() => setDialogTarget(null)} />
      <LocationDeleteDialog location={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </PageLayout>
  );
}
