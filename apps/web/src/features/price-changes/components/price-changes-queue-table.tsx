/**
 * Price Changes Queue Table (#3147, ADR-072)
 *
 * The "Price changes" tab body: mirrors
 * `docs/plans/mockups/price-changes-review-queue.html`'s `#queue-live` +
 * `#queue-body` — filters, the grouped table, the bulk-action bar, and the
 * loading/empty/error states (real ones, not the mockup's design-review
 * preview switcher).
 *
 * Accept/Edit open the #3148 confirm dialogs (price hero, rule sentence,
 * live-validated manual price, an admin-only "also set to Automatic"
 * opt-in with a real Undo). Bulk-accept opens its own dialog and, on
 * confirm, mounts the live `BulkPublishProgress` widget polling the real
 * batch-progress endpoint.
 *
 * #3164 review fixes rolled in here: URL-namespaced filters (`queueConn`/
 * `dir`/`big`), a select-all that can't desync from the visible page, a
 * refresh action for `needsRefresh` rows (now that #3162 ships one), an
 * unfiltered read for chip counts/eligibility (so filtering doesn't
 * collapse every OTHER chip to zero), reported bulk-ignore outcomes, real
 * shared primitives (`BulkActionBar`/`ProductThumbnail`/`Tooltip`) in place
 * of hand-rolled markup, and honest "queued" toast copy (accept/edit resolve
 * asynchronously in the worker, not on the 204 response).
 *
 * #3148 review fixes rolled in here: `BulkPublishProgress` is mounted as a
 * SIBLING of the table's own loading/empty/error branch rather than nested
 * inside it (finding 3 — nesting made it vanish the instant a fully-accepted
 * batch drained the list to empty), the "also set to Automatic" Undo toast
 * is aggregated into ONE toast for a bulk accept instead of one per pair
 * (finding 2), and every accept/edit/bulk-accept failure is translated
 * through `describePriceChangeActionError` rather than surfacing a raw
 * backend exception string — a stale-version 409 is a ROUTINE outcome under
 * the 30 s poll + per-dialog version snapshot, not an edge case (finding 9).
 *
 * @module apps/web/src/features/price-changes/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../../shared/ui/button';
import { Chip } from '../../../shared/ui/chip';
import { ErrorState, EmptyState } from '../../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../../shared/ui/data-table-skeleton';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { BulkActionBar } from '../../../shared/ui/bulk-action-bar';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../shared/ui/tooltip';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess, type WriteAccess } from '../../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../../shared/config/demo-mode';
import { formatAmount } from '../../../shared/format/format-amount';
import { useConnectionsQuery } from '../../connections';
import { useDemoMode } from '../../system';
import { usePriceChangesQuery } from '../hooks/use-price-changes-query';
import { useAcceptPriceChangeMutation } from '../hooks/use-accept-price-change-mutation';
import { useIgnorePriceChangeMutation } from '../hooks/use-ignore-price-change-mutation';
import { useEditPriceChangeMutation } from '../hooks/use-edit-price-change-mutation';
import { useUnresolvePriceChangeMutation } from '../hooks/use-unresolve-price-change-mutation';
import { useRefreshPriceChangeMutation } from '../hooks/use-refresh-price-change-mutation';
import { useBulkAcceptPriceChangesMutation } from '../hooks/use-bulk-accept-price-changes-mutation';
import { useSetSourceSyncModeMutation } from '../hooks/use-set-source-sync-mode-mutation';
import { AcceptPriceChangeDialog } from './accept-price-change-dialog';
import { EditPriceChangeDialog } from './edit-price-change-dialog';
import { BulkAcceptPriceChangesDialog } from './bulk-accept-price-changes-dialog';
import { BulkPublishProgress } from './bulk-publish-progress';
import type { PriceChangeItem } from '../api/price-changes.types';
import {
  STEEP_DELTA_TOOLTIP,
  deltaToneFor,
  describePriceChangeActionError,
  formatDeltaLabel,
  roundingLabelFor,
} from '../lib/price-change-copy';
import { useToast } from '../../../shared/ui/toast-provider';

/**
 * A destination that can carry a price-change episode — a marketplace
 * (`OfferManager`) or a shop write-back (`ProductPublisher`, e.g.
 * WooCommerce, #3164 review — the chips previously omitted every shop
 * destination, making one unfilterable in the queue).
 */
const DESTINATION_CAPABILITIES = ['OfferManager', 'ProductPublisher'];

/**
 * The chip-count/eligibility read is bounded to the API's own page-size
 * ceiling (#3162), never truly "all" — an install with more than this many
 * open episodes across every connection will under-count the long tail in
 * the per-connection chips specifically (the "All" chip's own count still
 * comes from the authoritative `total`, unaffected by this bound). A real
 * counts-by-connection endpoint would remove the need for this cap
 * entirely (#3164 review).
 */
const CHIP_COUNTS_LIMIT = 200;

/** Groups rows fanning from the same source event across several destinations. */
function groupKeyFor(item: PriceChangeItem): string {
  return `${item.productVariantId}:${item.sourceConnectionId}:${item.sourceOldAmount}:${item.sourceNewAmount}`;
}

function isSelectable(item: PriceChangeItem): boolean {
  return !item.resolvedAt && !item.needsRefresh;
}

type DirectionFilter = 'all' | 'up' | 'down';

function parseDirectionParam(value: string | null): DirectionFilter {
  return value === 'up' || value === 'down' ? value : 'all';
}

export function PriceChangesQueueTable(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();

  // Every action in this table publishes a price to a live marketplace/shop
  // (or mutates a connection's sync mode) and the backend guards every write
  // `@Roles('admin', 'operator')` — a `viewer` session holds `listings:read`
  // only. Gated the same way the rest of Listings gates its write
  // affordances (`useWriteAccess` + `ReadOnlyLock`, #1615): `visible` hides
  // the control entirely for a genuinely unauthorized (non-demo) session, and
  // `demoReadOnly` renders it disabled-with-a-tooltip for a public demo
  // viewer instead of leaving it enabled against an endpoint that would 403
  // (#3164 review, BLOCKING).
  const demoMode = useDemoMode();
  const write = useWriteAccess('listings:write', demoMode);

  // Namespaced (#3164 review) so this table's own filters are shareable/
  // reload-durable and neither collide with nor silently inherit the "All
  // listings" tab's `?connectionId` channel selector — a channel chosen
  // there must never pre-filter this queue.
  const connectionFilter = searchParams.get('queueConn') ?? 'all';
  const directionFilter = parseDirectionParam(searchParams.get('dir'));
  const magnitudeOnly = searchParams.get('big') === '1';

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acceptTarget, setAcceptTarget] = useState<PriceChangeItem | null>(null);
  const [editTarget, setEditTarget] = useState<PriceChangeItem | null>(null);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [activeBatch, setActiveBatch] = useState<{ id: string; items: PriceChangeItem[] } | null>(null);

  const connectionsQuery = useConnectionsQuery();
  const destinationConnections = (connectionsQuery.data ?? []).filter((c) =>
    DESTINATION_CAPABILITIES.some((cap) => c.enabledCapabilities.includes(cap)),
  );

  function setConnectionFilter(next: string): void {
    setSelected(new Set());
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === 'all') p.delete('queueConn');
      else p.set('queueConn', next);
      return p;
    });
  }

  function setDirectionFilter(next: DirectionFilter): void {
    setSelected(new Set());
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === 'all') p.delete('dir');
      else p.set('dir', next);
      return p;
    });
  }

  function toggleMagnitudeOnly(): void {
    setSelected(new Set());
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (p.get('big') === '1') p.delete('big');
      else p.set('big', '1');
      return p;
    });
  }

  function clearQueueFilters(): void {
    setSelected(new Set());
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete('queueConn');
      p.delete('dir');
      p.delete('big');
      return p;
    });
  }

  const query = usePriceChangesQuery({
    connectionId: connectionFilter === 'all' ? undefined : connectionFilter,
    direction: directionFilter === 'all' ? undefined : directionFilter,
    magnitudeLarge: magnitudeOnly || undefined,
  });

  // The unfiltered read that backs the chip list + per-chip counts (#3164
  // review) — `query` above is filtered server-side, so once ANY chip is
  // active its own `items` can no longer answer "how many for every OTHER
  // chip", which previously collapsed every other chip's count to zero.
  const unfilteredQuery = usePriceChangesQuery({ limit: CHIP_COUNTS_LIMIT });

  const acceptMutation = useAcceptPriceChangeMutation();
  const ignoreMutation = useIgnorePriceChangeMutation();
  const editMutation = useEditPriceChangeMutation();
  const unresolveMutation = useUnresolvePriceChangeMutation();
  const refreshMutation = useRefreshPriceChangeMutation();
  const bulkAcceptMutation = useBulkAcceptPriceChangesMutation();
  const setSourceSyncModeMutation = useSetSourceSyncModeMutation();
  const { showToast } = useToast();

  const items = query.data?.items ?? [];
  const unfilteredItems = unfilteredQuery.data?.items ?? [];

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = groupKeyFor(item);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  // The canonical "group start" index for each group key, computed once
  // over the WHOLE page rather than by comparing to the previous row
  // (#3164 review): the source's `detectedAt` is pinned at first detection
  // and never moves on a re-detection (by design, so "detected" keeps
  // meaning "first seen"), while a newly-mapped sibling in the same group
  // gets a fresh timestamp — so members of one group are not guaranteed to
  // sort adjacently, and an adjacency check renders two "group start"
  // borders for one group. Only the first occurrence (by index) is ever the
  // start; every other same-key row is a continuation, even when it is not
  // physically adjacent to its group's start.
  const groupFirstIndex = useMemo(() => {
    const firstIndex = new Map<string, number>();
    items.forEach((item, index) => {
      const key = groupKeyFor(item);
      if (!firstIndex.has(key)) firstIndex.set(key, index);
    });
    return firstIndex;
  }, [items]);

  const connectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of unfilteredItems) {
      counts.set(item.destinationConnectionId, (counts.get(item.destinationConnectionId) ?? 0) + 1);
    }
    return counts;
  }, [unfilteredItems]);

  const selectableIds = useMemo(() => items.filter(isSelectable).map((i) => i.id), [items]);
  const selectedIds = selectableIds.filter((id) => selected.has(id));

  /**
   * The "also set to Automatic" opt-in's confirmation, with a real Undo
   * (added `ShowToastOptions.action` to the shared toast provider for this —
   * it previously had no action-button slot). Takes a LIST of pairs so a
   * bulk accept renders ONE aggregated toast instead of one per pair
   * (#3148 review, finding 2) — N independently-expiring 4s toasts stacking
   * on a 12-pair bulk accept was unreadable and, worse, meant clicking one
   * Undo dismissed only its own toast while the other 11 kept ticking down.
   */
  function offerAutomaticUndo(
    pairs: Array<{ sourceConnectionId: string; destinationConnectionId: string; sourceLabel: string }>,
  ): void {
    if (pairs.length === 0) return;
    const description =
      pairs.length === 1
        ? `Future price changes from ${pairs[0].sourceLabel} will publish without review.`
        : `Future price changes from ${pairs.length} sources will publish without review.`;
    showToast({
      tone: 'success',
      title: pairs.length === 1 ? 'Set to Automatic' : `Turned on automatic pricing for ${pairs.length} sources`,
      description,
      action: {
        label: 'Undo',
        onClick: () => {
          for (const pair of pairs) {
            setSourceSyncModeMutation.mutate(
              {
                destinationConnectionId: pair.destinationConnectionId,
                sourceConnectionId: pair.sourceConnectionId,
                mode: 'manual',
              },
              {
                onSuccess: () => {
                  showToast({
                    tone: 'success',
                    description: `Reverted ${pair.sourceLabel} back to manual review.`,
                  });
                },
                onError: () => {
                  showToast({
                    tone: 'error',
                    description: `Couldn't undo automatic pricing for ${pair.sourceLabel}. Try again from the connection's settings.`,
                  });
                },
              },
            );
          }
        },
      },
    });
  }

  async function handleAcceptConfirm(item: PriceChangeItem, optInAutomatic: boolean): Promise<void> {
    try {
      await acceptMutation.mutateAsync({
        id: item.id,
        input: { expectedVersion: item.version, optInAutomatic },
      });
      // Accept/edit only ENQUEUE the publish — the destination write and the
      // episode's resolution happen later in the worker (#3164 review), so
      // the toast must not claim the price already published.
      if (optInAutomatic) {
        offerAutomaticUndo([
          {
            sourceConnectionId: item.sourceConnectionId,
            destinationConnectionId: item.destinationConnectionId,
            sourceLabel: item.sourceLabel,
          },
        ]);
      } else {
        showToast({
          tone: 'success',
          title: 'Price queued for publishing',
          description: `${item.productName} will update on ${item.destinationLabel} shortly.`,
        });
      }
    } catch (error) {
      console.error('Failed to accept price change', error);
      showToast({ tone: 'error', description: describePriceChangeActionError(error) });
    } finally {
      setAcceptTarget(null);
    }
  }

  async function handleIgnore(item: PriceChangeItem): Promise<void> {
    try {
      await ignoreMutation.mutateAsync(item.id);
    } catch (error) {
      console.error('Failed to ignore price change', error);
      showToast({ tone: 'error', description: describePriceChangeActionError(error) });
    }
  }

  async function handleUndo(item: PriceChangeItem): Promise<void> {
    try {
      await unresolveMutation.mutateAsync(item.id);
    } catch (error) {
      console.error('Failed to undo price change decision', error);
      showToast({ tone: 'error', description: describePriceChangeActionError(error) });
    }
  }

  async function handleRefresh(item: PriceChangeItem): Promise<void> {
    try {
      await refreshMutation.mutateAsync(item.id);
      showToast({
        tone: 'success',
        description: `Refreshed — showing the latest price for ${item.productName}.`,
      });
    } catch (error) {
      console.error('Failed to refresh price change', error);
      showToast({ tone: 'error', description: describePriceChangeActionError(error) });
    }
  }

  async function handleEditConfirm(item: PriceChangeItem, manualPriceOverride: number): Promise<void> {
    try {
      await editMutation.mutateAsync({
        id: item.id,
        input: { manualPriceOverride, expectedVersion: item.version },
      });
      setEditTarget(null);
      // Same "queued, not published" honesty as the accept path above.
      showToast({
        tone: 'success',
        title: 'Price queued for publishing',
        description: `${item.productName} will update on ${item.destinationLabel} shortly.`,
      });
    } catch (error) {
      console.error('Failed to publish edited price change', error);
      showToast({ tone: 'error', description: describePriceChangeActionError(error) });
    }
  }

  const bulkDialogItems = items.filter((i) => selectedIds.includes(i.id));

  async function handleBulkAcceptConfirm(optInPairs: Set<string>): Promise<void> {
    // Each item MUST carry the staleness token — the backend's
    // `BulkAcceptPriceChangeItemDto.expectedVersion` is required (#3145/
    // #3162), for the same reason the single-accept path's is: a bulk item
    // publishes `computedNewAmount`, which can move between this read and
    // the submit. `bulkDialogItems` (derived from `items`, not `selectedIds`
    // alone) is the source of the version, since the version lives on the
    // row, not the id (#3164 review, reconciled here with the #3148 dialog
    // flow's opt-in-to-automatic pairing).
    try {
      const result = await bulkAcceptMutation.mutateAsync(
        bulkDialogItems.map((item) => ({
          id: item.id,
          optInAutomatic: optInPairs.has(`${item.sourceConnectionId}:${item.destinationConnectionId}`),
          expectedVersion: item.version,
        })),
      );
      setActiveBatch({ id: result.batchId, items: bulkDialogItems });
      setBulkDialogOpen(false);
      setSelected(new Set());

      if (optInPairs.size > 0) {
        const byPairKey = new Map(
          bulkDialogItems.map((item) => [
            `${item.sourceConnectionId}:${item.destinationConnectionId}`,
            item.sourceLabel,
          ]),
        );
        offerAutomaticUndo(
          Array.from(optInPairs, (pair) => {
            const [sourceConnectionId, destinationConnectionId] = pair.split(':');
            return {
              sourceConnectionId,
              destinationConnectionId,
              sourceLabel: byPairKey.get(pair) ?? 'this source',
            };
          }),
        );
      }
    } catch (error) {
      console.error('Bulk accept failed', error);
      showToast({ tone: 'error', description: describePriceChangeActionError(error) });
    }
  }

  async function handleBulkIgnore(): Promise<void> {
    // No bulk-ignore endpoint exists (#3164 review), so this stays a
    // sequential loop of the single-item mutation — but the outcome is now
    // REPORTED rather than swallowed (`.catch(() => undefined)`): a wholly
    // failed bulk ignore used to look identical to a successful one.
    let succeeded = 0;
    let failed = 0;
    for (const id of selectedIds) {
      try {
        await ignoreMutation.mutateAsync(id);
        succeeded += 1;
      } catch {
        failed += 1;
      }
    }
    setSelected(new Set());
    if (failed === 0) {
      showToast({
        tone: 'success',
        title: `Kept ${succeeded} price${succeeded === 1 ? '' : 's'}`,
        description: 'The old prices remain live.',
      });
    } else if (succeeded === 0) {
      showToast({
        tone: 'error',
        description: `Couldn't keep any of the ${failed} selected price${failed === 1 ? '' : 's'}. Try again.`,
      });
    } else {
      showToast({
        tone: 'error',
        description: `Kept ${succeeded}, but ${failed} failed. Try again for the rest.`,
      });
    }
  }

  function toggleSelected(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(): void {
    setSelected((prev) => {
      const selectedVisible = selectableIds.filter((id) => prev.has(id));
      if (selectableIds.length > 0 && selectedVisible.length === selectableIds.length) {
        return new Set();
      }
      return new Set(selectableIds);
    });
  }

  const allSelected = selectedIds.length > 0 && selectedIds.length === selectableIds.length;
  const hasQueueFilters = connectionFilter !== 'all' || directionFilter !== 'all' || magnitudeOnly;

  return (
    <div className="price-changes-queue">
      <div className="tab-toolbar">
        <p>
          One row per destination — a price that changed once at the source can produce a separate,
          independently-reviewable change on every marketplace or shop it&apos;s published to. Prices
          include VAT.
        </p>
        {hasQueueFilters ? (
          <Button tone="ghost" className="button--sm" onClick={clearQueueFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="filter-bar" role="group" aria-label="Filter by connection">
        <span className="filter-bar__label">Connection</span>
        <Chip active={connectionFilter === 'all'} onClick={() => setConnectionFilter('all')}>
          All <span className="chip__count">{unfilteredQuery.data?.total ?? 0}</span>
        </Chip>
        {destinationConnections.map((connection) => (
          <Chip
            key={connection.id}
            active={connectionFilter === connection.id}
            onClick={() => setConnectionFilter(connection.id)}
          >
            {connection.name} <span className="chip__count">{connectionCounts.get(connection.id) ?? 0}</span>
          </Chip>
        ))}
      </div>
      <div className="filter-bar" role="group" aria-label="Filter by price direction">
        <span className="filter-bar__label">Price change</span>
        <Chip active={directionFilter === 'all'} onClick={() => setDirectionFilter('all')}>
          All
        </Chip>
        <Chip active={directionFilter === 'up'} onClick={() => setDirectionFilter('up')}>
          ↑ Increases
        </Chip>
        <Chip active={directionFilter === 'down'} onClick={() => setDirectionFilter('down')}>
          ↓ Decreases
        </Chip>
        <Chip active={magnitudeOnly} onClick={toggleMagnitudeOnly}>
          Big changes (10% or more)
        </Chip>
      </div>

      {query.data && query.data.hiddenStaleCount > 0 ? (
        <p className="filter-note">
          {query.data.hiddenStaleCount} more change
          {query.data.hiddenStaleCount === 1 ? " isn't" : 's are not'} shown here because that listing
          is paused.
        </p>
      ) : null}

      {query.isPending ? (
        // The four `queue-*` container states are the mockup's own vocabulary
        // (`docs/plans/mockups/price-changes-review-queue.html` — `#queue-live`
        // / `#queue-loading` / `#queue-empty` / `#queue-error`), so an E2E spec
        // can bind to them by name per `§ UX Mockups` — they were declared but
        // never emitted here (#3164 review). Distinct from and additive to the
        // finer per-row `data-state` values below, which answer a different
        // question ("what is THIS row's resolution") on a different element.
        <div data-state="queue-loading">
          <DataTableSkeleton columns={7} label="Loading price changes…" />
        </div>
      ) : query.error ? (
        <div data-state="queue-error">
          <ErrorState
            title="Couldn't load price changes"
            message={query.error.message}
            action={
              <Button tone="secondary" onClick={() => void query.refetch()}>
                Try again
              </Button>
            }
          />
        </div>
      ) : items.length === 0 ? (
        <div data-state="queue-empty">
          <EmptyState
            title="You're all caught up"
            message="Nothing needs your attention right now. We'll show new price changes here as soon as one happens in your shop."
          />
        </div>
      ) : (
        <div data-state="queue-live">
          <div className="table-wrap">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      {write.visible ? (
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                        />
                      ) : null}
                    </th>
                    <th>Product</th>
                    <th>Changed in</th>
                    <th>Connection</th>
                    <th>
                      Price on this connection <span className="th-sub">incl. VAT</span>
                    </th>
                    <th>Detected</th>
                    <th className="col-num">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => {
                    const groupKey = groupKeyFor(item);
                    const isGroupStart = groupFirstIndex.get(groupKey) === index;
                    const isGrouped = (groupCounts.get(groupKey) ?? 0) > 1;
                    const rowState = rowStateFor(item);
                    const rowClasses = [
                      item.resolvedAt ? 'is-resolved' : '',
                      isGroupStart ? 'is-group-start' : '',
                      isGrouped ? 'is-grouped' : '',
                      item.needsRefresh && !item.resolvedAt ? 'is-flagged' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');

                    return (
                      <tr
                        key={item.id}
                        id={`price-change-row-${item.id}`}
                        data-testid="price-change-row"
                        data-row-id={item.id}
                        data-state={rowState}
                        className={rowClasses || undefined}
                      >
                        <td>
                          {write.visible ? (
                            <input
                              type="checkbox"
                              data-testid="row-select"
                              aria-label={`Select ${item.productName} on ${item.destinationLabel}`}
                              checked={selected.has(item.id)}
                              disabled={!isSelectable(item)}
                              onChange={() => toggleSelected(item.id)}
                            />
                          ) : null}
                        </td>
                        <td>
                          {isGroupStart ? (
                            <div className="cell-product">
                              <ProductThumbnail name={item.productName} src={null} size="md" />
                              <div className="cell-product__text">
                                <div className="cell-product__name" title={item.productName}>
                                  {item.productName}
                                  {item.variantLabel ? (
                                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                                      {' '}
                                      — {item.variantLabel}
                                    </span>
                                  ) : null}
                                </div>
                                {item.sku ? <div className="cell-product__sku">{item.sku}</div> : null}
                              </div>
                            </div>
                          ) : (
                            <div className="cell-continuation">
                              <span aria-hidden="true">↳</span>
                              Also changes here{' '}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="cell-continuation__help"
                                    aria-label="What does this mean?"
                                  >
                                    ?
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  One price change, one more listing to update. You can accept, edit, or
                                  ignore each listing on its own.
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="cell-product__source">
                            <Link
                              className="connection-tag"
                              data-testid="row-source-tag"
                              to={`/connections/${item.sourceConnectionId}/pricing-sync`}
                            >
                              {item.sourceLabel}
                            </Link>
                          </div>
                          <div className="cell-product__source">
                            {formatAmount(item.sourceOldAmount, item.sourceCurrency)} →{' '}
                            {formatAmount(item.sourceNewAmount, item.sourceCurrency)}
                          </div>
                        </td>
                        <td>
                          <Link
                            className="connection-tag"
                            data-testid="row-connection-tag"
                            to={`/connections/${item.destinationConnectionId}`}
                          >
                            {item.destinationLabel}
                          </Link>
                        </td>
                        <td>
                          <PriceCell item={item} />
                        </td>
                        <td>
                          <TimeDisplay iso={item.detectedAt} format="datetime" />
                        </td>
                        <td className="col-num">
                          <ActionCell
                            item={item}
                            write={write}
                            onAccept={setAcceptTarget}
                            onEdit={setEditTarget}
                            onIgnore={handleIgnore}
                            onUndo={handleUndo}
                            onRefresh={handleRefresh}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <BulkActionBar
            count={selectedIds.length}
            itemNoun="price change"
            actions={
              <>
                <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                  <Button
                    tone="secondary"
                    disabled={write.demoReadOnly}
                    onClick={() => void handleBulkIgnore()}
                  >
                    Keep prices
                  </Button>
                </ReadOnlyLock>
                <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                  <Button disabled={write.demoReadOnly} onClick={() => setBulkDialogOpen(true)}>
                    Accept selected
                  </Button>
                </ReadOnlyLock>
              </>
            }
          />
        </div>
      )}

      {/* A sibling of the branch above, not nested inside it (#3148 review,
          finding 3) — the widget must keep polling even once a successful
          bulk publish has drained the queue to empty, or a failed refetch
          has left `items` empty for an unrelated reason. */}
      {activeBatch ? (
        <BulkPublishProgress
          batchId={activeBatch.id}
          items={activeBatch.items}
          onDismiss={() => setActiveBatch(null)}
        />
      ) : null}

      <AcceptPriceChangeDialog
        item={acceptTarget}
        isConfirming={acceptMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setAcceptTarget(null);
        }}
        onConfirm={(optInAutomatic) => {
          if (acceptTarget) void handleAcceptConfirm(acceptTarget, optInAutomatic);
        }}
      />
      <EditPriceChangeDialog
        item={editTarget}
        isConfirming={editMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        onConfirm={(manualPriceOverride) => {
          if (editTarget) void handleEditConfirm(editTarget, manualPriceOverride);
        }}
      />
      <BulkAcceptPriceChangesDialog
        items={bulkDialogItems}
        open={bulkDialogOpen}
        isConfirming={bulkAcceptMutation.isPending}
        onOpenChange={setBulkDialogOpen}
        onConfirm={(optInPairs) => void handleBulkAcceptConfirm(optInPairs)}
      />
    </div>
  );
}

function rowStateFor(item: PriceChangeItem): string {
  if (item.resolution === 'accepted-custom') return 'row-accepted-custom';
  if (item.resolution === 'accepted') return 'row-accepted';
  if (item.resolution === 'ignored') return 'row-ignored';
  if (item.needsRefresh) return 'row-needs-refresh';
  return 'row-pending';
}

function PriceCell({ item }: { item: PriceChangeItem }): ReactElement {
  const tone = deltaToneFor(item);
  const displayNew = item.manualPriceOverride ?? item.computedNewAmount;
  const roundingLabel = roundingLabelFor(item.ruleSummary.rounding);
  const currency = item.destinationCurrency ?? undefined;
  const oldLabel = item.computedOldAmount === null ? '—' : formatAmount(item.computedOldAmount, currency);
  // `.delta-chip--up`/`.delta-chip--down` render byte-identical colors,
  // matching the mockup's own choice (it distinguishes the two with an SVG
  // arrow, not color) — the mockup was verified to make the SAME choice
  // (#3164 review). A decorative arrow closes the gap without touching the
  // queried label text: it lives in its own sibling span, so
  // `screen.getByText('-15%')` keeps matching the label alone.
  // Only up/down get the icon — flat/steep keep the label as a bare text
  // child (unchanged from before this fix), so an existing query for the
  // rendered label (`getByText('0%')`) still returns the classed chip span
  // itself rather than a newly-introduced text wrapper.
  const directionIcon = tone === 'up' ? '▲' : tone === 'down' ? '▼' : null;
  const label = formatDeltaLabel(item.deltaPct);
  const deltaChip = (
    <span className={`delta-chip delta-chip--${tone}`} tabIndex={tone === 'steep' ? 0 : undefined}>
      {directionIcon ? (
        <>
          <span aria-hidden="true" className="delta-chip__icon">
            {directionIcon}
          </span>
          <span>{label}</span>
        </>
      ) : (
        label
      )}
    </span>
  );

  return (
    <>
      <div className="price-compare">
        <span className="price-compare__old">{oldLabel}</span>
        <span>→</span>
        <span className="price-compare__new">{formatAmount(displayNew, currency)}</span>
        {tone === 'steep' ? (
          <Tooltip>
            <TooltipTrigger asChild>{deltaChip}</TooltipTrigger>
            <TooltipContent>{STEEP_DELTA_TOOLTIP}</TooltipContent>
          </Tooltip>
        ) : (
          deltaChip
        )}
      </div>
      {roundingLabel && !item.resolvedAt ? (
        <div className="cell-product__source">Rounded: {roundingLabel}</div>
      ) : null}
    </>
  );
}

function ActionCell({
  item,
  write,
  onAccept,
  onEdit,
  onIgnore,
  onUndo,
  onRefresh,
}: {
  item: PriceChangeItem;
  write: WriteAccess;
  onAccept: (item: PriceChangeItem) => void;
  onEdit: (item: PriceChangeItem) => void;
  onIgnore: (item: PriceChangeItem) => Promise<void>;
  onUndo: (item: PriceChangeItem) => Promise<void>;
  onRefresh: (item: PriceChangeItem) => Promise<void>;
}): ReactElement {
  if (item.resolution === 'accepted' || item.resolution === 'accepted-custom') {
    return (
      <span
        className={`status-note ${item.resolution === 'accepted-custom' ? 'status-note--custom' : 'status-note--accepted'}`}
        data-testid={item.resolution === 'accepted-custom' ? 'row-applied-custom' : 'row-applied'}
      >
        {item.resolution === 'accepted-custom' ? 'Published · your price' : 'Published'}
      </span>
    );
  }
  if (item.resolution === 'ignored') {
    return (
      <span className="status-note" data-testid="row-ignored">
        Kept the old price{' '}
        {write.visible ? (
          <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
            <button
              type="button"
              className="undo"
              data-undo={item.id}
              disabled={write.demoReadOnly}
              onClick={() => void onUndo(item)}
            >
              Undo
            </button>
          </ReadOnlyLock>
        ) : null}
      </span>
    );
  }
  if (item.needsRefresh) {
    return (
      <div className="refresh-note">
        <span className="refresh-note__text">
          This price changed again while you were deciding — refresh to see the latest.
        </span>
        {write.visible ? (
          <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
            <Button
              tone="secondary"
              className="button--xs"
              data-testid="row-refresh"
              disabled={write.demoReadOnly}
              onClick={() => void onRefresh(item)}
            >
              Refresh
            </Button>
          </ReadOnlyLock>
        ) : null}
      </div>
    );
  }
  if (!write.visible) {
    return <></>;
  }
  return (
    <div className="row-actions">
      <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
        <Button
          tone="secondary"
          className="button--xs"
          data-testid="row-ignore"
          disabled={write.demoReadOnly}
          onClick={() => void onIgnore(item)}
        >
          Keep price
        </Button>
      </ReadOnlyLock>
      <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
        <Button
          tone="secondary"
          className="button--xs"
          data-testid="row-edit"
          disabled={write.demoReadOnly}
          onClick={() => onEdit(item)}
        >
          Edit
        </Button>
      </ReadOnlyLock>
      <ReadOnlyLock active={write.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
        <Button
          className="button--xs"
          data-testid="row-accept"
          disabled={write.demoReadOnly}
          onClick={() => onAccept(item)}
        >
          Accept
        </Button>
      </ReadOnlyLock>
    </div>
  );
}
