/**
 * Fulfillment Status Poll Rule
 *
 * Turns what a POLLING holder reports (`FulfillmentStatusSource`, absolute
 * per-line counters) into the progress events `IFulfillmentProgressService`
 * records (deltas against the work's own counters). Pure: the work and the
 * snapshot enter as arguments, so the rule is the same for every executor.
 *
 * - Units the holder newly fulfilled become one `picked` event.
 * - Once every line is settled (fulfilled + cancelled covers the line), the
 *   work has left the holder: `shipped` when anything was fulfilled, then
 *   `closed` when nothing was cancelled, or `short_picked` for the cancelled
 *   units, which closes the work `incomplete`.
 * - A cancellation reported while other lines are still open is not acted on
 *   yet: `short_picked` closes the work, so it waits for the final answer.
 *
 * Every idempotency key is derived from the observed counters, so a poll that
 * sees the same state again records nothing, and a new state gets a new key.
 * Deltas are clamped to what each line can still take, so a holder reporting
 * more than was asked never breaks the line's capacity rule.
 *
 * @module libs/core/src/fulfillment/domain/types
 */
import type { FulfillmentProgressSnapshot } from './fulfillment-execution.types';
import type {
  FulfillmentProgressEvent,
  FulfillmentProgressLineDelta,
} from './fulfillment-progress-event.types';
import type { FulfillmentWork } from './fulfillment-work.types';

export function deriveProgressEventsFromSnapshot(
  work: FulfillmentWork,
  snapshot: FulfillmentProgressSnapshot,
  now: Date
): FulfillmentProgressEvent[] {
  const reported = new Map(snapshot.lines.map((line) => [line.workLineId, line]));
  const occurredAt = snapshot.observedAt ?? now;
  const base = { workId: work.id, connectionId: snapshot.work.connectionId, occurredAt };

  let settled = work.lines.length > 0;
  let fulfilledTotal = 0;
  let cancelledTotal = 0;
  const picked: FulfillmentProgressLineDelta[] = [];
  const cancelled: FulfillmentProgressLineDelta[] = [];

  for (const line of work.lines) {
    const seen = reported.get(line.id);
    const fulfilled = Math.min(line.totalQuantity, Math.max(0, seen?.fulfilledQuantity ?? 0));
    const cancelledQty = Math.min(
      line.totalQuantity - fulfilled,
      Math.max(0, seen?.cancelledQuantity ?? 0)
    );
    fulfilledTotal += fulfilled;
    cancelledTotal += cancelledQty;
    if (fulfilled + cancelledQty < line.totalQuantity) {
      settled = false;
    }

    const room = line.totalQuantity - line.fulfilledQuantity - line.cancelledQuantity;
    const fulfilledDelta = Math.min(room, Math.max(0, fulfilled - line.fulfilledQuantity));
    if (fulfilledDelta > 0) {
      picked.push({ orderLineId: line.orderLineId, fulfilledDelta, cancelledDelta: 0 });
    }
    const cancelledDelta = Math.min(
      room - fulfilledDelta,
      Math.max(0, cancelledQty - line.cancelledQuantity)
    );
    if (cancelledDelta > 0) {
      cancelled.push({ orderLineId: line.orderLineId, fulfilledDelta: 0, cancelledDelta });
    }
  }

  const stamp = `${fulfilledTotal}:${cancelledTotal}`;
  const events: FulfillmentProgressEvent[] = [];
  if (picked.length > 0) {
    events.push({
      ...base,
      kind: 'picked',
      idempotencyKey: `poll:${work.id}:picked:${stamp}`,
      lines: picked,
    });
  }
  if (!settled) {
    return events;
  }
  if (fulfilledTotal > 0) {
    events.push({ ...base, kind: 'shipped', idempotencyKey: `poll:${work.id}:shipped` });
  }
  if (cancelled.length > 0) {
    events.push({
      ...base,
      kind: 'short_picked',
      idempotencyKey: `poll:${work.id}:short_picked:${stamp}`,
      lines: cancelled,
    });
  } else if (cancelledTotal === 0) {
    events.push({ ...base, kind: 'closed', idempotencyKey: `poll:${work.id}:closed` });
  }
  return events;
}
