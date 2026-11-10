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
 * #3237 migrated the hand-rolled `<table>` onto the shared `DataTable` +
 * `DataTableCardView` primitive (which is where the responsive card layout
 * now lives, replacing #3223's own CSS grid) — made possible by `DataTable`
 * gaining `rowClassName`/`rowAttributes`, since this queue hangs its grouping
 * treatment and its `data-state`/`id`/`data-testid` handles on the row
 * element, which the primitive used to hard-code.
 *
 * #3325 rolled in here: the connection filter-bar chip counts now read a
 * real server-side counts-by-connection endpoint
 * (`usePriceChangeCountsQuery`) instead of a client-side bucketing of a
 * `CHIP_COUNTS_LIMIT`-bounded unfiltered `usePriceChangesQuery` read, which
 * under-counted a connection's chip past 200 open episodes across the
 * install. The "All" chip's own total was always exact (it read the
 * unfiltered read's own server-computed `total`) — only the per-connection
 * bucketing suffered. `CHIP_COUNTS_LIMIT` is gone.
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
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { DataTableSkeleton } from '../../../shared/ui/data-table-skeleton';
import { KeyValueList } from '../../../shared/ui/key-value-list';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { BulkActionBar } from '../../../shared/ui/bulk-action-bar';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../shared/ui/tooltip';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useWriteAccess, type WriteAccess } from '../../../shared/auth/use-permission';
import { demoReadOnlyActionMessage } from '../../../shared/config/demo-mode';
import { formatAmount } from '../../../shared/format/format-amount';
import { useConnectionsQuery } from '../../connections';
import { useDemoMode } from '../../system';
import { usePriceChangesQuery } from '../hooks/use-price-changes-query';
import { usePriceChangeCountsQuery } from '../hooks/use-price-change-counts-query';
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
import { PricingRulesPickerDialog } from './pricing-rules-picker-dialog';
import { AutoAppliedNote } from './auto-applied-note';
import type { PriceChangeItem } from '../api/price-changes.types';
import { deltaToneFor, formatDeltaLabel, roundingLabelFor } from '../lib/price-rule-labels';
import { describePriceChangeActionError } from '../lib/describe-price-change-error';
import { interpolate, usePlural, useMessages } from '../../../shared/i18n';
import { useToast } from '../../../shared/ui/toast-provider';
import { describeApiError } from '../../../shared/api/describe-api-error';

/**
 * A destination that can carry a price-change episode — a marketplace
 * (`OfferManager`) or a shop write-back (`ProductPublisher`, e.g.
 * WooCommerce, #3164 review — the chips previously omitted every shop
 * destination, making one unfilterable in the queue).
 */
const DESTINATION_CAPABILITIES = ['OfferManager', 'ProductPublisher'];

/**
 * How long the "also set to Automatic" Undo stays offered (#3165 round-3
 * review). Deliberately many times the toast provider's 4s default: this is
 * the operator's only chance to reverse a switch to publishing prices without
 * review before the setting persists silently on the connection.
 */
const AUTOMATIC_OPT_IN_UNDO_MS = 30_000;

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
  const copy = useMessages('price-changes').priceChangesQueueTable;
  const plural = usePlural();

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
  // there must never pre-filter this queue. The connection settings page's
  // "N changes waiting — review them" deep link (#3149) therefore writes
  // this same `queueConn` param rather than a separate prop, so arriving
  // here from that link pre-filters through the identical, already-shareable
  // mechanism a manual chip click uses — no extra prop plumbing needed.
  const connectionFilter = searchParams.get('queueConn') ?? 'all';
  const directionFilter = parseDirectionParam(searchParams.get('dir'));
  const magnitudeOnly = searchParams.get('big') === '1';

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acceptTarget, setAcceptTarget] = useState<PriceChangeItem | null>(null);
  const [editTarget, setEditTarget] = useState<PriceChangeItem | null>(null);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [activeBatch, setActiveBatch] = useState<{ id: string; items: PriceChangeItem[] } | null>(null);

  const connectionsQuery = useConnectionsQuery();
  // Also feeds the #3150 rules picker: rules live on any DESTINATION
  // (OfferManager or ProductPublisher), the same predicate the connection
  // filter chips above already use — one declaration, not a second copy.
  const destinationConnections = (connectionsQuery.data ?? []).filter((c) =>
    DESTINATION_CAPABILITIES.some((cap) => c.enabledCapabilities.includes(cap)),
  );
  const [pricingRulesPickerOpen, setPricingRulesPickerOpen] = useState(false);

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

  // The exact, server-side counts-by-connection read that backs the chip
  // list (#3325) — `query` above is filtered server-side, so once ANY chip
  // is active its own `items` can no longer answer "how many for every
  // OTHER chip", which is why this is a SEPARATE, unfiltered read rather
  // than derived from `query`.
  const countsQuery = usePriceChangeCountsQuery();

  const acceptMutation = useAcceptPriceChangeMutation();
  const ignoreMutation = useIgnorePriceChangeMutation();
  const editMutation = useEditPriceChangeMutation();
  const unresolveMutation = useUnresolvePriceChangeMutation();
  const refreshMutation = useRefreshPriceChangeMutation();
  const bulkAcceptMutation = useBulkAcceptPriceChangesMutation();
  const setSourceSyncModeMutation = useSetSourceSyncModeMutation();
  const { showToast } = useToast();

  const items = query.data?.items ?? [];

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = groupKeyFor(item);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  // The set of item ids that are the canonical "group start" for their group
  // key, computed once over the WHOLE page rather than by comparing to the
  // previous row (#3164 review): the source's `detectedAt` is pinned at
  // first detection and never moves on a re-detection (by design, so
  // "detected" keeps meaning "first seen"), while a newly-mapped sibling in
  // the same group gets a fresh timestamp — so members of one group are not
  // guaranteed to sort adjacently, and an adjacency check renders two "group
  // start" borders for one group. Only the first occurrence (by array order)
  // is ever the start; every other same-key row is a continuation, even when
  // it is not physically adjacent to its group's start. Keyed by item id
  // (#3237) rather than by array index — `rowClassName`/`rowAttributes`
  // receive the row, not its position, and an item's id is the stable
  // identity across re-sorts the index never was.
  const groupStartIds = useMemo(() => {
    const seenKeys = new Set<string>();
    const startIds = new Set<string>();
    for (const item of items) {
      const key = groupKeyFor(item);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        startIds.add(item.id);
      }
    }
    return startIds;
  }, [items]);

  // A chip count is a claim about the operator's own data, so it must never be
  // made from a read that is still in flight or that failed
  // (`docs/frontend-architecture.md § Paginated Totals As A Second Stage` — a
  // failed count leaves the placeholder and never renders `0`, because absence
  // and "none matched" are different claims). Every chip reads the same
  // counts query, so they go dark together rather than each asserting a
  // confident zero; `?? 0` below stays correct once the data IS known, where a
  // connection genuinely absent from the response has no open episodes.
  const chipCountsUnavailable = countsQuery.isError;
  const chipCountsKnown = !chipCountsUnavailable && countsQuery.data !== undefined;
  const renderChipCount = (value: number) => {
    if (chipCountsUnavailable) {
      return <span className="chip__count">—</span>;
    }
    if (!chipCountsKnown) {
      return null;
    }
    return <span className="chip__count">{value}</span>;
  };

  const connectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of countsQuery.data?.byConnection ?? []) {
      counts.set(entry.connectionId, entry.count);
    }
    return counts;
  }, [countsQuery.data]);

  const selectableIds = useMemo(() => items.filter(isSelectable).map((i) => i.id), [items]);
  const selectedIds = selectableIds.filter((id) => selected.has(id));

  /**
   * The "also set to Automatic" opt-in's confirmation, with a real Undo
   * (added `ShowToastOptions.action` to the shared toast provider for this —
   * it previously had no action-button slot). Takes a LIST of pairs so a
   * bulk accept renders ONE aggregated toast instead of one per pair
   * (#3148 review, finding 2) — N independently-expiring toasts stacking on a
   * 12-pair bulk accept was unreadable and, worse, meant clicking one Undo
   * dismissed only its own toast while the other 11 kept ticking down.
   *
   * It also runs far longer than the provider's 4s default (#3165 round-3
   * review): this Undo is the only window in which an operator can reverse a
   * switch to publishing prices WITHOUT review, and past it the setting
   * persists silently on the connection until someone opens its settings
   * page. Four seconds is not a decision window for that. The in-row Undo on
   * an ignored row is the stack's other precedent and has no timer at all;
   * this toast cannot follow that shape (there is no row to hang it on after
   * a bulk accept), so it buys the time instead.
   */
  function offerAutomaticUndo(
    pairs: Array<{ sourceConnectionId: string; destinationConnectionId: string; sourceLabel: string }>,
  ): void {
    if (pairs.length === 0) return;
    const optIn = copy.automaticOptIn;
    const description =
      pairs.length === 1
        ? interpolate(optIn.description, { source: pairs[0].sourceLabel })
        : plural(pairs.length, optIn.descriptionMany);
    showToast({
      tone: 'success',
      title: pairs.length === 1 ? optIn.title : plural(pairs.length, optIn.titleMany),
      description,
      durationMs: AUTOMATIC_OPT_IN_UNDO_MS,
      action: {
        label: optIn.undo,
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
                    description: interpolate(optIn.reverted, { source: pair.sourceLabel }),
                  });
                },
                onError: () => {
                  showToast({
                    tone: 'error',
                    description: interpolate(optIn.undoFailed, { source: pair.sourceLabel }),
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
          title: copy.queued.title,
          description: interpolate(copy.queued.description, {
            product: item.productName,
            destination: item.destinationLabel,
          }),
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
        description: interpolate(copy.refreshed, { product: item.productName }),
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
        title: copy.queued.title,
        description: interpolate(copy.queued.description, {
          product: item.productName,
          destination: item.destinationLabel,
        }),
      });
    } catch (error) {
      console.error('Failed to publish edited price change', error);
      showToast({ tone: 'error', description: describePriceChangeActionError(error) });
    }
  }

  // Every item MUST carry the staleness token — the backend's
  // `BulkAcceptPriceChangeItemDto.expectedVersion` is required (#3145/
  // #3162), for the same reason the single-accept path's is: a bulk item
  // publishes `computedNewAmount`, which can move between this read and the
  // submit. `bulkDialogItems` is the FROZEN snapshot the dialog was opened
  // with (the same frozen-target discipline the accept/edit dialogs use),
  // so its `version` is "the version the operator was shown", not whatever
  // the 30 s poll may have since re-fetched.
  const bulkDialogItems = items.filter((i) => selectedIds.includes(i.id));

  async function handleBulkAcceptConfirm(optInPairs: Set<string>): Promise<void> {
    try {
      const result = await bulkAcceptMutation.mutateAsync(
        bulkDialogItems.map((item) => ({
          id: item.id,
          expectedVersion: item.version,
          optInAutomatic: optInPairs.has(`${item.sourceConnectionId}:${item.destinationConnectionId}`),
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
              sourceLabel: byPairKey.get(pair) ?? copy.automaticOptIn.fallbackSource,
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
    const failedIds: string[] = [];
    for (const id of selectedIds) {
      try {
        await ignoreMutation.mutateAsync(id);
        succeeded += 1;
      } catch {
        failedIds.push(id);
      }
    }
    const failed = failedIds.length;
    // Keep the FAILED rows selected (#3164 re-review, SUGGESTION) — the toast
    // below tells the operator to "try again for the rest", so clearing the
    // whole selection leaves them nothing to retry and no way to tell which
    // rows the "rest" were.
    setSelected(new Set(failedIds));
    if (failed === 0) {
      showToast({
        tone: 'success',
        title: plural(succeeded, copy.bulkIgnore.keptTitle),
        description: copy.bulkIgnore.keptDescription,
      });
    } else if (succeeded === 0) {
      showToast({
        tone: 'error',
        description: plural(failed, copy.bulkIgnore.allFailed),
      });
    } else {
      showToast({
        tone: 'error',
        description: interpolate(copy.bulkIgnore.partial, { succeeded, failed }),
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

  /**
   * The classes the queue's rows hung on their own hand-rolled `<tr>` before
   * #3237, unchanged — `is-group-start`/`is-grouped` for the fan-out accent,
   * `is-resolved` for the muted-row treatment, `is-flagged` for the
   * needs-refresh highlight. `DataTable`'s own `rowClassName` appends these to
   * its computed `data-table__row …` list rather than replacing it.
   *
   * Derived from `rowStateFor` (review follow-up, #3327) rather than
   * re-reading `item.resolvedAt`/`item.needsRefresh` directly, so this class
   * list, `cardMetaFor`'s mobile badge, and the `data-state` attribute can
   * never disagree about the same row's state - they all fold through the
   * one function that already computes it.
   */
  function rowClassNameFor(item: PriceChangeItem): string | undefined {
    const groupKey = groupKeyFor(item);
    const isGroupStart = groupStartIds.has(item.id);
    const isGrouped = (groupCounts.get(groupKey) ?? 0) > 1;
    const state = rowStateFor(item);
    const classes = [
      isRowStateResolved(state) ? 'is-resolved' : '',
      isGroupStart ? 'is-group-start' : '',
      isGrouped ? 'is-grouped' : '',
      state === 'row-needs-refresh' ? 'is-flagged' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return classes || undefined;
  }

  /**
   * The mobile counterpart of the desktop `is-resolved`/`is-flagged` row
   * tint (audit follow-up, #3237). `DataTable`'s `rowClassName`/
   * `rowAttributes` hooks are deliberately desktop-`<tr>`-only —
   * `DataTableCardView` renders solely from its own slots, with no per-card
   * class hook, so a card cannot reproduce the `<tr>`'s background tint
   * directly. `ActionCell` already states a resolved/needs-refresh row's
   * state as TEXT on both layouts (`Published`/`Kept the old price`/the
   * refresh prompt), so this is a passive-scanning aid on top of an
   * already-present fact rather than new information — reached through the
   * existing `meta` slot, so it costs no primitive change.
   *
   * Derived from `rowStateFor` - see `rowClassNameFor`'s docblock.
   */
  function cardMetaFor(item: PriceChangeItem): ReactElement | null {
    const state = rowStateFor(item);
    if (isRowStateResolved(state)) {
      return (
        <StatusBadge tone="neutral" compact data-testid="card-status-resolved">
          {copy.cardStatus.resolved}
        </StatusBadge>
      );
    }
    if (state === 'row-needs-refresh') {
      return (
        <StatusBadge tone="warning" compact withDot data-testid="card-status-flagged">
          {copy.cardStatus.needsRefresh}
        </StatusBadge>
      );
    }
    return null;
  }

  /** The per-row `id`/`data-testid`/`data-row-id`/`data-state` handles, unchanged from the pre-#3237 `<tr>`. */
  function rowAttributesFor(item: PriceChangeItem): Record<string, string> {
    return {
      id: `price-change-row-${item.id}`,
      'data-testid': 'price-change-row',
      'data-row-id': item.id,
      'data-state': rowStateFor(item),
    };
  }

  /**
   * Shared verbatim by the desktop `product` column and the mobile card
   * `title` slot (the `renderSelectCheckbox` precedent orders-list-page.tsx
   * established) — so a continuation row's "Also changes here" treatment,
   * the one piece of content that actually encodes grouping, cannot drift
   * between the two layouts.
   */
  function renderProductIdentity(item: PriceChangeItem): ReactElement {
    if (groupStartIds.has(item.id)) {
      return (
        <div className="cell-product">
          <ProductThumbnail name={item.productName} src={null} size="md" />
          <div className="cell-product__text">
            <div className="cell-product__name" title={item.productName}>
              {item.productName}
              {item.variantLabel ? (
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> — {item.variantLabel}</span>
              ) : null}
            </div>
            {item.sku ? <div className="cell-product__sku">{item.sku}</div> : null}
          </div>
        </div>
      );
    }
    return (
      <div className="cell-continuation">
        <span aria-hidden="true">{'↳'}</span>
        {copy.continuation.label}{' '}
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="cell-continuation__help" aria-label={copy.continuation.helpLabel}>
              ?
            </button>
          </TooltipTrigger>
          <TooltipContent>{copy.continuation.tooltip}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  /** Shared verbatim by the desktop select column and the mobile card select slot (#1620 precedent). */
  function renderSelectCheckbox(item: PriceChangeItem): ReactElement {
    return (
      <input
        type="checkbox"
        data-testid="row-select"
        aria-label={interpolate(copy.selectRow, {
          product: item.productName,
          destination: item.destinationLabel,
        })}
        checked={selected.has(item.id)}
        disabled={!isSelectable(item)}
        onChange={() => toggleSelected(item.id)}
      />
    );
  }

  const columns: DataTableColumn<PriceChangeItem>[] = [
    {
      id: 'select',
      header: write.visible ? (
        <input type="checkbox" aria-label={copy.selectAll} checked={allSelected} onChange={toggleSelectAll} />
      ) : null,
      cell: (item) => (write.visible ? renderSelectCheckbox(item) : null),
    },
    {
      id: 'product',
      header: copy.columns.product,
      cell: (item) => renderProductIdentity(item),
    },
    {
      id: 'changedIn',
      header: copy.columns.changedIn,
      cell: (item) => (
        <>
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
          <PriceChangeCauseNote item={item} />
        </>
      ),
    },
    {
      id: 'connection',
      header: copy.columns.connection,
      cell: (item) => (
        <Link
          className="connection-tag"
          data-testid="row-connection-tag"
          to={`/connections/${item.destinationConnectionId}/pricing-sync`}
        >
          {item.destinationLabel}
        </Link>
      ),
    },
    {
      id: 'price',
      header: (
        <>
          {copy.columns.price} <span className="th-sub">{copy.columns.priceSub}</span>
        </>
      ),
      cell: (item) => <PriceCell item={item} />,
    },
    {
      id: 'detected',
      header: copy.columns.detected,
      cell: (item) => <TimeDisplay iso={item.detectedAt} format="datetime" />,
    },
    {
      id: 'action',
      header: copy.columns.action,
      align: 'right',
      cell: (item) => (
        <ActionCell
          item={item}
          write={write}
          onAccept={setAcceptTarget}
          onEdit={setEditTarget}
          onIgnore={handleIgnore}
          onUndo={handleUndo}
          onRefresh={handleRefresh}
        />
      ),
    },
  ];

  return (
    <div className="price-changes-queue">
      <div className="tab-toolbar">
        <p>{copy.toolbar.intro}</p>
        <Button
          tone="secondary"
          className="button--sm"
          id="btn-pricing-rules"
          onClick={() => setPricingRulesPickerOpen(true)}
        >
          {copy.toolbar.pricingRules}
        </Button>
        {hasQueueFilters ? (
          <Button tone="ghost" className="button--sm" onClick={clearQueueFilters}>
            {copy.toolbar.clearFilters}
          </Button>
        ) : null}
      </div>

      <PricingRulesPickerDialog
        open={pricingRulesPickerOpen}
        onOpenChange={setPricingRulesPickerOpen}
        destinationConnections={destinationConnections}
      />

      <AutoAppliedNote destinationConnections={destinationConnections} />

      <div className="filter-bar" role="group" aria-label={copy.filters.connectionGroup}>
        <span className="filter-bar__label">{copy.filters.connectionLabel}</span>
        <Chip active={connectionFilter === 'all'} onClick={() => setConnectionFilter('all')}>
          {copy.filters.all} {renderChipCount(countsQuery.data?.total ?? 0)}
        </Chip>
        {destinationConnections.map((connection) => (
          <Chip
            key={connection.id}
            active={connectionFilter === connection.id}
            onClick={() => setConnectionFilter(connection.id)}
          >
            {connection.name} {renderChipCount(connectionCounts.get(connection.id) ?? 0)}
          </Chip>
        ))}
      </div>
      <div className="filter-bar" role="group" aria-label={copy.filters.directionGroup}>
        <span className="filter-bar__label">{copy.filters.directionLabel}</span>
        <Chip active={directionFilter === 'all'} onClick={() => setDirectionFilter('all')}>
          {copy.filters.all}
        </Chip>
        <Chip active={directionFilter === 'up'} onClick={() => setDirectionFilter('up')}>
          {copy.filters.increases}
        </Chip>
        <Chip active={directionFilter === 'down'} onClick={() => setDirectionFilter('down')}>
          {copy.filters.decreases}
        </Chip>
        <Chip active={magnitudeOnly} onClick={toggleMagnitudeOnly}>
          {copy.filters.bigChanges}
        </Chip>
      </div>

      {query.data && query.data.hiddenStaleCount > 0 ? (
        <p className="filter-note">{plural(query.data.hiddenStaleCount, copy.hiddenStale)}</p>
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
          <DataTableSkeleton columns={7} label={copy.loading} />
        </div>
      ) : query.error ? (
        <div data-state="queue-error">
          <ErrorState
            title={copy.error.title}
            message={describeApiError(query.error, 'price-changes')}
            action={
              <Button tone="secondary" onClick={() => void query.refetch()}>
                {copy.error.tryAgain}
              </Button>
            }
          />
        </div>
      ) : items.length === 0 ? (
        <div data-state="queue-empty">
          <EmptyState
            title={copy.empty.title}
            message={copy.empty.message}
          />
        </div>
      ) : (
        <div data-state="queue-live">
          <DataTable
            caption={copy.caption}
            columns={columns}
            rows={items}
            rowKey={(item) => item.id}
            rowClassName={rowClassNameFor}
            rowAttributes={rowAttributesFor}
            footer={
              <BulkActionBar
                count={selectedIds.length}
                selectedLabel={copy.bulk.selected}
                actions={
                  <>
                    <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
                      <Button
                        tone="secondary"
                        disabled={write.demoReadOnly}
                        onClick={() => void handleBulkIgnore()}
                      >
                        {copy.bulk.keepPrices}
                      </Button>
                    </ReadOnlyLock>
                    <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
                      <Button disabled={write.demoReadOnly} onClick={() => setBulkDialogOpen(true)}>
                        {copy.bulk.acceptSelected}
                      </Button>
                    </ReadOnlyLock>
                  </>
                }
              />
            }
            cardView={{
              ...(write.visible ? { select: (item: PriceChangeItem) => renderSelectCheckbox(item) } : {}),
              title: (item) => renderProductIdentity(item),
              meta: (item) => cardMetaFor(item),
              summary: (item) => (
                <KeyValueList
                  items={[
                    {
                      id: 'changed-in',
                      label: copy.columns.changedIn,
                      value: (
                        <>
                          <Link
                            className="connection-tag"
                            data-testid="row-source-tag"
                            to={`/connections/${item.sourceConnectionId}/pricing-sync`}
                          >
                            {item.sourceLabel}
                          </Link>
                          <div className="cell-product__source">
                            {formatAmount(item.sourceOldAmount, item.sourceCurrency)} →{' '}
                            {formatAmount(item.sourceNewAmount, item.sourceCurrency)}
                          </div>
                          <PriceChangeCauseNote item={item} />
                        </>
                      ),
                    },
                    {
                      id: 'connection',
                      label: copy.columns.connection,
                      value: (
                        <Link
                          className="connection-tag"
                          data-testid="row-connection-tag"
                          to={`/connections/${item.destinationConnectionId}/pricing-sync`}
                        >
                          {item.destinationLabel}
                        </Link>
                      ),
                    },
                    {
                      id: 'price',
                      label: copy.columns.priceCard,
                      value: <PriceCell item={item} />,
                    },
                    {
                      id: 'detected',
                      label: copy.columns.detected,
                      value: <TimeDisplay iso={item.detectedAt} format="datetime" />,
                    },
                  ]}
                />
              ),
              actions: (item) => (
                <ActionCell
                  item={item}
                  write={write}
                  onAccept={setAcceptTarget}
                  onEdit={setEditTarget}
                  onIgnore={handleIgnore}
                  onUndo={handleUndo}
                  onRefresh={handleRefresh}
                />
              ),
            }}
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

type RowState =
  | 'row-accepted-custom'
  | 'row-accepted'
  | 'row-ignored'
  | 'row-needs-refresh'
  | 'row-pending';

/**
 * The single derivation of a row's state, read by `data-state`,
 * `rowClassNameFor` and `cardMetaFor` (review follow-up, #3327) - see
 * `rowClassNameFor`'s docblock for why collapsing three independent
 * re-derivations onto this one function is load-bearing rather than
 * cosmetic.
 */
function rowStateFor(item: PriceChangeItem): RowState {
  if (item.resolution === 'accepted-custom') return 'row-accepted-custom';
  if (item.resolution === 'accepted') return 'row-accepted';
  if (item.resolution === 'ignored') return 'row-ignored';
  if (item.needsRefresh) return 'row-needs-refresh';
  return 'row-pending';
}

/** Any resolved state (accepted, accepted-custom or ignored) - the "is-resolved" bucket. */
function isRowStateResolved(state: RowState): boolean {
  return state === 'row-accepted' || state === 'row-accepted-custom' || state === 'row-ignored';
}

function PriceCell({ item }: { item: PriceChangeItem }): ReactElement {
  const copy = useMessages('price-changes');
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
            <TooltipContent>{copy.priceRuleLabels.steepTooltip}</TooltipContent>
          </Tooltip>
        ) : (
          deltaChip
        )}
      </div>
      {roundingLabel && !item.resolvedAt ? (
        <div className="cell-product__source">
          {interpolate(copy.priceChangesQueueTable.rounded, { rounding: roundingLabel })}
        </div>
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
  const copy = useMessages('price-changes').priceChangesQueueTable.actions;
  if (item.resolution === 'accepted' || item.resolution === 'accepted-custom') {
    return (
      <span
        className={`status-note ${item.resolution === 'accepted-custom' ? 'status-note--custom' : 'status-note--accepted'}`}
        data-testid={item.resolution === 'accepted-custom' ? 'row-applied-custom' : 'row-applied'}
      >
        {item.resolution === 'accepted-custom' ? copy.publishedCustom : copy.published}
      </span>
    );
  }
  if (item.resolution === 'ignored') {
    return (
      <span className="status-note" data-testid="row-ignored">
        {copy.kept}{' '}
        {write.visible ? (
          <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
            <button
              type="button"
              className="undo"
              data-undo={item.id}
              disabled={write.demoReadOnly}
              onClick={() => void onUndo(item)}
            >
              {copy.undo}
            </button>
          </ReadOnlyLock>
        ) : null}
      </span>
    );
  }
  if (item.needsRefresh) {
    return (
      <div className="refresh-note">
        <span className="refresh-note__text">{copy.needsRefresh}</span>
        {write.visible ? (
          <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
            <Button
              tone="secondary"
              className="button--xs"
              data-testid="row-refresh"
              disabled={write.demoReadOnly}
              onClick={() => void onRefresh(item)}
            >
              {copy.refresh}
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
      <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
        <Button
          tone="secondary"
          className="button--xs"
          data-testid="row-ignore"
          disabled={write.demoReadOnly}
          onClick={() => void onIgnore(item)}
        >
          {copy.keepPrice}
        </Button>
      </ReadOnlyLock>
      <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
        <Button
          tone="secondary"
          className="button--xs"
          data-testid="row-edit"
          disabled={write.demoReadOnly}
          onClick={() => onEdit(item)}
        >
          {copy.edit}
        </Button>
      </ReadOnlyLock>
      <ReadOnlyLock active={write.demoReadOnly} message={demoReadOnlyActionMessage()}>
        <Button
          className="button--xs"
          data-testid="row-accept"
          disabled={write.demoReadOnly}
          onClick={() => onAccept(item)}
        >
          {copy.accept}
        </Button>
      </ReadOnlyLock>
    </div>
  );
}

/**
 * Says why a row exists when it is not an ordinary price move (ADR-077). The
 * one-off net-to-gross correction lifts many prices by the VAT rate at once;
 * without this an operator sees a wall of +23% changes and no reason for them.
 * The backend never auto-applies these rows, so the note also explains why a
 * pair in automatic mode is waiting for review.
 */
function PriceChangeCauseNote({ item }: { item: PriceChangeItem }): ReactElement | null {
  const copy = useMessages('price-changes').priceChangesQueueTable.causeNote;
  if (item.cause !== 'tax-basis-correction') return null;
  return (
    <div className="cell-product__source">
      <StatusBadge tone="info" compact data-testid="row-cause-tax-basis">
        {copy.vatCorrection}
      </StatusBadge>{' '}
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="cell-continuation__help" aria-label={copy.whyLabel}>
            ?
          </button>
        </TooltipTrigger>
        <TooltipContent>{copy.tooltip}</TooltipContent>
      </Tooltip>
    </div>
  );
}
