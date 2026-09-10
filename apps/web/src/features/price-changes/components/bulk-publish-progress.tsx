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
 * dialog) as static per-connection counts, and all flip to "done" together
 * once the batch reaches a terminal status — true per-item, per-connection
 * live attribution needs a backend change (`records[].connectionId`) this
 * issue does not make.
 *
 * @module apps/web/src/features/price-changes/components
 */
import type { ReactElement } from 'react';
import { useBulkBatchQuery, TERMINAL_BULK_BATCH_STATUSES } from '../../listings';
import type { PriceChangeItem } from '../api/price-changes.types';

interface BulkPublishProgressProps {
  batchId: string;
  items: PriceChangeItem[];
}

export function BulkPublishProgress({ batchId, items }: BulkPublishProgressProps): ReactElement | null {
  const query = useBulkBatchQuery(batchId);
  const batch = query.data;

  if (!batch) return null;

  const done = batch.succeededCount + batch.failedCount;
  const isTerminal = TERMINAL_BULK_BATCH_STATUSES.includes(batch.status);
  const pct = batch.totalCount > 0 ? Math.round((done / batch.totalCount) * 100) : 0;

  const lanes = new Map<string, { label: string; count: number }>();
  for (const item of items) {
    const lane = lanes.get(item.destinationConnectionId);
    if (lane) lane.count += 1;
    else lanes.set(item.destinationConnectionId, { label: item.destinationLabel, count: 1 });
  }

  return (
    <div className="publish-progress is-active" data-state="bulk-publish-progress">
      <div className="publish-progress__head">
        <span className="publish-progress__title">Sending your price changes…</span>
        <span className="publish-progress__count">
          {done} / {batch.totalCount}
        </span>
      </div>
      <div className="publish-progress__track">
        <div className="publish-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="publish-progress__lanes">
        {Array.from(lanes.entries()).map(([connectionId, lane]) => (
          <span
            key={connectionId}
            className={`publish-progress__lane ${isTerminal ? 'is-done' : ''}`}
          >
            <b>{isTerminal ? lane.count : 0}</b>/{lane.count} {lane.label}
          </span>
        ))}
      </div>
    </div>
  );
}
