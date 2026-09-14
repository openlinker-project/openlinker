/**
 * BulkPublishProgress (#3148, ADR-072 decision 9)
 *
 * Polls the REAL `bulk_offer_creation_batches` progress endpoint via the
 * existing `useBulkBatchQuery` hook — the same mechanism
 * `bulk-batch-progress-page.tsx` already consumes. No client-side
 * `setTimeout` simulation.
 *
 * **Known gap, flagged rather than papered over**: `BulkBatchSummary.records`
 * carries no `connectionId` (offer-creation batches are always single-
 * connection, so it was never needed) — a price-change batch can span
 * several destinations. Per-connection lanes are therefore rendered from the
 * CLIENT's own known item list (the set the operator confirmed in the bulk
 * dialog) as static per-connection COMPOSITION counts — "N items destined
 * for this connection" — rather than a live per-connection progress figure;
 * true per-item, per-connection live attribution needs a backend change
 * (`records[].connectionId`) this issue does not make.
 *
 * **#3148 review, findings 3/4 — this component previously**: (a) rendered
 * `null` while loading, on a failed poll, and on an unreadable batch, which
 * collapsed three distinct states into silence with nothing telling the
 * operator anything went wrong; and (b) rendered a per-connection `n/N`
 * that stayed `0/N` for the ENTIRE run and then jumped to full all at once
 * — contradicting the correct aggregate `done/total` bar right above it,
 * since there is no real per-connection count to report (see the gap noted
 * above). Both are fixed here: every reachable state renders something,
 * and the per-connection row is composition-only (no fabricated `n/N`).
 * **Mounting**: the caller (`price-changes-queue-table.tsx`) renders this
 * as a SIBLING of the table's own loading/empty/error branch, not nested
 * inside it — nesting meant the widget vanished the instant the list
 * drained to empty (the most common outcome of a successful bulk publish),
 * which read as "nothing is happening" while marketplace writes could still
 * be in flight.
 *
 * @module apps/web/src/features/price-changes/components
 */
import type { ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { useBulkBatchQuery, TERMINAL_BULK_BATCH_STATUSES } from '../../listings';
import type { PriceChangeItem } from '../api/price-changes.types';

interface BulkPublishProgressProps {
  batchId: string;
  items: PriceChangeItem[];
  onDismiss: () => void;
}

export function BulkPublishProgress({ batchId, items, onDismiss }: BulkPublishProgressProps): ReactElement {
  const query = useBulkBatchQuery(batchId);
  const batch = query.data;

  const lanes: Array<{ connectionId: string; label: string; count: number }> = [];
  const laneIndex = new Map<string, number>();
  for (const item of items) {
    const existingIndex = laneIndex.get(item.destinationConnectionId);
    if (existingIndex !== undefined) {
      lanes[existingIndex].count += 1;
    } else {
      laneIndex.set(item.destinationConnectionId, lanes.length);
      lanes.push({ connectionId: item.destinationConnectionId, label: item.destinationLabel, count: 1 });
    }
  }

  if (query.isPending) {
    return (
      <div className="publish-progress is-active" data-state="bulk-publish-progress-loading">
        <span className="publish-progress__title">Checking on your price changes…</span>
      </div>
    );
  }

  if (query.isError || !batch) {
    return (
      <div className="publish-progress publish-progress--error" data-state="bulk-publish-progress-failed">
        <span className="publish-progress__title">
          Couldn&apos;t check on this publish. It may still be running — try again, or reload this page.
        </span>
        <div className="publish-progress__actions">
          <Button tone="secondary" className="button--xs" onClick={() => void query.refetch()}>
            Try again
          </Button>
          <Button tone="ghost" className="button--xs" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    );
  }

  const done = batch.succeededCount + batch.failedCount;
  const isTerminal = TERMINAL_BULK_BATCH_STATUSES.includes(batch.status);
  const pct = batch.totalCount > 0 ? Math.round((done / batch.totalCount) * 100) : 0;

  const title = isTerminal
    ? batch.failedCount > 0
      ? `Published ${batch.succeededCount} of ${batch.totalCount} — ${batch.failedCount} failed`
      : `Published ${batch.succeededCount} of ${batch.totalCount} prices`
    : 'Sending your price changes…';

  return (
    <div className={`publish-progress ${isTerminal ? '' : 'is-active'}`} data-state="bulk-publish-progress">
      <div className="publish-progress__head">
        <span className="publish-progress__title">{title}</span>
        <span className="publish-progress__count">
          {done} / {batch.totalCount}
        </span>
      </div>
      <div className="publish-progress__track">
        <div className="publish-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="publish-progress__lanes">
        {lanes.map((lane) => (
          <span
            key={lane.connectionId}
            className={`publish-progress__lane ${isTerminal ? 'is-done' : ''}`}
          >
            {lane.count} · {lane.label}
          </span>
        ))}
      </div>
      {isTerminal ? (
        <div className="publish-progress__actions">
          <Button tone="ghost" className="button--xs" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}
