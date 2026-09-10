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
 * live-validated manual price, "also set to Automatic" opt-in with a real
 * Undo). Bulk-accept opens its own dialog and, on confirm, mounts the live
 * `BulkPublishProgress` widget polling the real batch-progress endpoint.
 *
 * @module apps/web/src/features/price-changes/components
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../shared/ui/button';
import { ErrorState, EmptyState } from '../../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../../shared/ui/data-table-skeleton';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { formatAmount } from '../../../shared/format/format-amount';
import { useConnectionsQuery } from '../../connections';
import { usePriceChangesQuery } from '../hooks/use-price-changes-query';
import { useAcceptPriceChangeMutation } from '../hooks/use-accept-price-change-mutation';
import { useIgnorePriceChangeMutation } from '../hooks/use-ignore-price-change-mutation';
import { useEditPriceChangeMutation } from '../hooks/use-edit-price-change-mutation';
import { useUnresolvePriceChangeMutation } from '../hooks/use-unresolve-price-change-mutation';
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
  formatDeltaLabel,
  roundingLabelFor,
} from '../lib/price-change-copy';
import { useToast } from '../../../shared/ui/toast-provider';

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Groups rows fanning from the same source event across several destinations. */
function groupKeyFor(item: PriceChangeItem): string {
  return `${item.productVariantId}:${item.sourceConnectionId}:${item.sourceOldAmount}:${item.sourceNewAmount}`;
}

export interface PriceChangesQueueTableProps {
  /**
   * Pre-selects the connection chip — used by the connection settings page's
   * "N changes waiting — review them" deep link (#3149), which lands here
   * with `?view=queue&connectionId=...` already pre-filtered.
   */
  initialConnectionId?: string;
}

export function PriceChangesQueueTable({
  initialConnectionId,
}: PriceChangesQueueTableProps = {}): ReactElement {
  const [connectionFilter, setConnectionFilter] = useState<string>(initialConnectionId ?? 'all');
  const [directionFilter, setDirectionFilter] = useState<'all' | 'up' | 'down'>('all');
  const [magnitudeOnly, setMagnitudeOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const connectionsQuery = useConnectionsQuery();
  const offerManagerConnections = (connectionsQuery.data ?? []).filter((c) =>
    c.enabledCapabilities.includes('OfferManager'),
  );

  const query = usePriceChangesQuery({
    connectionId: connectionFilter === 'all' ? undefined : connectionFilter,
    direction: directionFilter === 'all' ? undefined : directionFilter,
    magnitudeLarge: magnitudeOnly || undefined,
  });

  const acceptMutation = useAcceptPriceChangeMutation();
  const ignoreMutation = useIgnorePriceChangeMutation();
  const editMutation = useEditPriceChangeMutation();
  const unresolveMutation = useUnresolvePriceChangeMutation();
  const bulkAcceptMutation = useBulkAcceptPriceChangesMutation();
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

  const connectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.destinationConnectionId, (counts.get(item.destinationConnectionId) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const selectedIds = Array.from(selected).filter((id) => items.some((i) => i.id === id));

  const [acceptTarget, setAcceptTarget] = useState<PriceChangeItem | null>(null);
  const [editTarget, setEditTarget] = useState<PriceChangeItem | null>(null);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [activeBatch, setActiveBatch] = useState<{ id: string; items: PriceChangeItem[] } | null>(null);

  const setSourceSyncModeMutation = useSetSourceSyncModeMutation();

  /**
   * The "also set to Automatic" opt-in's confirmation, with a real Undo
   * (added `ShowToastOptions.action` to the shared toast provider for this —
   * it previously had no action-button slot).
   */
  function offerAutomaticUndo(destinationConnectionId: string, sourceConnectionId: string): void {
    const sourceLabel =
      items.find((i) => i.sourceConnectionId === sourceConnectionId)?.sourceLabel ?? 'this source';
    showToast({
      tone: 'success',
      title: 'Set to Automatic',
      description: `Future price changes from ${sourceLabel} will publish without review.`,
      action: {
        label: 'Undo',
        onClick: () => {
          setSourceSyncModeMutation.mutate({
            destinationConnectionId,
            sourceConnectionId,
            mode: 'manual',
          });
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
      setAcceptTarget(null);
      if (optInAutomatic) {
        offerAutomaticUndo(item.destinationConnectionId, item.sourceConnectionId);
      } else {
        showToast({ tone: 'success', title: 'Price published', description: item.productName });
      }
    } catch (error) {
      showToast({ tone: 'error', description: error instanceof Error ? error.message : 'Failed to accept' });
    }
  }

  async function handleIgnore(item: PriceChangeItem): Promise<void> {
    try {
      await ignoreMutation.mutateAsync(item.id);
    } catch (error) {
      showToast({ tone: 'error', description: error instanceof Error ? error.message : 'Failed to ignore' });
    }
  }

  async function handleUndo(item: PriceChangeItem): Promise<void> {
    try {
      await unresolveMutation.mutateAsync(item.id);
    } catch (error) {
      showToast({ tone: 'error', description: error instanceof Error ? error.message : 'Failed to undo' });
    }
  }

  async function handleEditConfirm(item: PriceChangeItem, manualPriceOverride: number): Promise<void> {
    try {
      await editMutation.mutateAsync({
        id: item.id,
        input: { manualPriceOverride, expectedVersion: item.version },
      });
      setEditTarget(null);
      showToast({ tone: 'success', title: 'Price published', description: item.productName });
    } catch (error) {
      showToast({ tone: 'error', description: error instanceof Error ? error.message : 'Failed to publish' });
    }
  }

  const bulkDialogItems = items.filter((i) => selectedIds.includes(i.id));

  async function handleBulkAcceptConfirm(optInPairs: Set<string>): Promise<void> {
    try {
      const result = await bulkAcceptMutation.mutateAsync(
        bulkDialogItems.map((item) => ({
          id: item.id,
          optInAutomatic: optInPairs.has(`${item.sourceConnectionId}:${item.destinationConnectionId}`),
        })),
      );
      setActiveBatch({ id: result.batchId, items: bulkDialogItems });
      setBulkDialogOpen(false);
      setSelected(new Set());
      for (const pair of optInPairs) {
        const [sourceConnectionId, destinationConnectionId] = pair.split(':');
        offerAutomaticUndo(destinationConnectionId, sourceConnectionId);
      }
    } catch (error) {
      showToast({ tone: 'error', description: error instanceof Error ? error.message : 'Bulk accept failed' });
    }
  }

  async function handleBulkIgnore(): Promise<void> {
    for (const id of selectedIds) {
      // eslint-disable-next-line no-await-in-loop -- sequential, matching the mockup's "one at a time" disclaimer
      await ignoreMutation.mutateAsync(id).catch(() => undefined);
    }
    setSelected(new Set());
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
    const selectableIds = items.filter((i) => !i.resolvedAt && !i.needsRefresh).map((i) => i.id);
    setSelected((prev) => (prev.size === selectableIds.length ? new Set() : new Set(selectableIds)));
  }

  return (
    <div className="price-changes-queue">
      <div className="tab-toolbar">
        <p>
          One row per destination — a price that changed once at the source can produce a separate,
          independently-reviewable change on every marketplace or shop it&apos;s published to. Prices
          include VAT.
        </p>
      </div>

      <div className="filter-bar" role="group" aria-label="Filter by connection">
        <span className="filter-bar__label">Connection</span>
        <button
          type="button"
          className={`chip ${connectionFilter === 'all' ? 'chip--active' : ''}`}
          onClick={() => setConnectionFilter('all')}
        >
          All <span className="chip__count">{items.length}</span>
        </button>
        {offerManagerConnections.map((connection) => (
          <button
            key={connection.id}
            type="button"
            className={`chip ${connectionFilter === connection.id ? 'chip--active' : ''}`}
            onClick={() => setConnectionFilter(connection.id)}
          >
            {connection.name} <span className="chip__count">{connectionCounts.get(connection.id) ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="filter-bar" role="group" aria-label="Filter by price direction">
        <span className="filter-bar__label">Price change</span>
        <button
          type="button"
          className={`chip ${directionFilter === 'all' ? 'chip--active' : ''}`}
          onClick={() => setDirectionFilter('all')}
        >
          All
        </button>
        <button
          type="button"
          className={`chip ${directionFilter === 'up' ? 'chip--active' : ''}`}
          onClick={() => setDirectionFilter('up')}
        >
          ↑ Increases
        </button>
        <button
          type="button"
          className={`chip ${directionFilter === 'down' ? 'chip--active' : ''}`}
          onClick={() => setDirectionFilter('down')}
        >
          ↓ Decreases
        </button>
        <button
          type="button"
          className={`chip ${magnitudeOnly ? 'chip--active' : ''}`}
          onClick={() => setMagnitudeOnly((v) => !v)}
        >
          Big changes (10% or more)
        </button>
      </div>

      {query.data && query.data.hiddenStaleCount > 0 ? (
        <p className="filter-note">
          {query.data.hiddenStaleCount} more change
          {query.data.hiddenStaleCount === 1 ? " isn't" : 's are not'} shown here because that listing
          is paused.
        </p>
      ) : null}

      {query.isPending ? (
        <DataTableSkeleton columns={7} label="Loading price changes…" />
      ) : query.error ? (
        <ErrorState
          title="Couldn't load price changes"
          message={query.error.message}
          action={
            <Button tone="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="You're all caught up"
          message="Nothing needs your attention right now. We'll show new price changes here as soon as one happens in your shop."
        />
      ) : (
        <>
          <div className="table-wrap">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={selected.size > 0 && selected.size === items.filter((i) => !i.resolvedAt && !i.needsRefresh).length}
                        onChange={toggleSelectAll}
                      />
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
                    const isGroupStart = index === 0 || groupKeyFor(items[index - 1]) !== groupKey;
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
                          <input
                            type="checkbox"
                            data-testid="row-select"
                            aria-label={`Select ${item.productName} on ${item.destinationLabel}`}
                            checked={selected.has(item.id)}
                            disabled={!!item.resolvedAt || item.needsRefresh}
                            onChange={() => toggleSelected(item.id)}
                          />
                        </td>
                        <td>
                          {isGroupStart ? (
                            <div className="cell-product">
                              <span className="thumb" aria-hidden="true">
                                {initials(item.productName)}
                              </span>
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
                              <span
                                className="cell-continuation__help"
                                title="One price change, one more listing to update. You can accept, edit, or ignore each listing on its own."
                              >
                                ?
                              </span>
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
                            onAccept={setAcceptTarget}
                            onEdit={setEditTarget}
                            onIgnore={handleIgnore}
                            onUndo={handleUndo}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {selectedIds.length > 0 ? (
            <div className="bulk-action-bar is-visible" data-state="bulk-action-bar">
              <div className="bulk-action-bar__count">
                <b>{selectedIds.length}</b> selected
              </div>
              <div className="bulk-action-bar__actions">
                <Button tone="secondary" onClick={() => void handleBulkIgnore()}>
                  Keep prices
                </Button>
                <Button onClick={() => setBulkDialogOpen(true)}>Accept selected</Button>
              </div>
            </div>
          ) : null}

          {activeBatch ? (
            <BulkPublishProgress batchId={activeBatch.id} items={activeBatch.items} />
          ) : null}
        </>
      )}

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

  return (
    <>
      <div className="price-compare">
        <span className="price-compare__old">{formatAmount(item.computedOldAmount, item.destinationCurrency)}</span>
        <span>→</span>
        <span className="price-compare__new">{formatAmount(displayNew, item.destinationCurrency)}</span>
        <span
          className={`delta-chip delta-chip--${tone}`}
          title={tone === 'steep' ? STEEP_DELTA_TOOLTIP : undefined}
        >
          {formatDeltaLabel(item.deltaPct)}
        </span>
      </div>
      {roundingLabel && !item.resolvedAt ? (
        <div className="cell-product__source">Rounded: {roundingLabel}</div>
      ) : null}
    </>
  );
}

function ActionCell({
  item,
  onAccept,
  onEdit,
  onIgnore,
  onUndo,
}: {
  item: PriceChangeItem;
  onAccept: (item: PriceChangeItem) => void;
  onEdit: (item: PriceChangeItem) => void;
  onIgnore: (item: PriceChangeItem) => Promise<void>;
  onUndo: (item: PriceChangeItem) => Promise<void>;
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
        <button type="button" className="undo" data-undo={item.id} onClick={() => void onUndo(item)}>
          Undo
        </button>
      </span>
    );
  }
  if (item.needsRefresh) {
    return (
      <div className="refresh-note">
        <span className="refresh-note__text">
          This price changed again while you were deciding — refresh to see the latest.
        </span>
      </div>
    );
  }
  return (
    <div className="row-actions">
      <Button tone="secondary" className="button--xs" data-testid="row-ignore" onClick={() => void onIgnore(item)}>
        Keep price
      </Button>
      <Button tone="secondary" className="button--xs" data-testid="row-edit" onClick={() => onEdit(item)}>
        Edit
      </Button>
      <Button className="button--xs" data-testid="row-accept" onClick={() => onAccept(item)}>
        Accept
      </Button>
    </div>
  );
}
