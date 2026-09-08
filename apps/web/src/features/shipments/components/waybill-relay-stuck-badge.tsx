/**
 * Waybill Relay Stuck Badge (#2073)
 *
 * Renders on a `/shipments` row whose waybill relay has failed enough times in
 * a row to escalate — the operator-facing half of a condition that used to
 * produce one `logger.error` per poll tick and nothing else, while the
 * marketplace silently never learned the order shipped.
 *
 * **`stuck` is read, never derived.** The backend owns the threshold and ships
 * the boolean; `apps/web` cannot import `@openlinker/core` (#591), so
 * recomputing it here would be a mirror needing a `check:invariants` guard.
 * There is deliberately no comparison in this file.
 *
 * **It sits BESIDE the status badge, never inside the severity word.**
 * `deriveSeverityLabel` returns exactly one of Fix / Finish / Send / View and
 * partitions the rows; a stuck relay is orthogonal to it — a `delivered`
 * shipment can carry one, because the parcel arrived and the channel was still
 * never told. Folding it in would either hide a dispatch problem behind a relay
 * one or claim two facts with one word. Same reasoning as the reservation
 * shortfall badge sitting beside order health rather than inside it (#2350).
 *
 * @module apps/web/src/features/shipments/components
 */
import type { ReactElement } from 'react';

import { StatusBadge } from '../../../shared/ui/status-badge';
import { WAYBILL_RELAY_REASON_LABEL, type WaybillRelay } from '../api/shipments.types';

export interface WaybillRelayStuckBadgeProps {
  waybillRelay: WaybillRelay | null;
}

/**
 * The full sentence, used as the badge's `title` so the short label stays
 * scannable while the cause is one hover away.
 *
 * An unrecognised reason degrades to the count alone rather than to a guess —
 * the backend coerces a value this build does not know to `null`, and inventing
 * copy for it would state something about the operator's system that nothing
 * observed.
 */
export function describeWaybillRelayStuck(waybillRelay: WaybillRelay): string {
  const attempts = `${waybillRelay.failureCount} attempt${waybillRelay.failureCount === 1 ? '' : 's'}`;
  const cause =
    waybillRelay.lastFailureReason === null
      ? null
      : WAYBILL_RELAY_REASON_LABEL[waybillRelay.lastFailureReason];
  const base = `The tracking number has not reached the sales channel after ${attempts}`;
  return cause === null
    ? `${base}. The buyer has not been notified.`
    : `${base} - last failure: ${cause}. The buyer has not been notified.`;
}

export function WaybillRelayStuckBadge({
  waybillRelay,
}: WaybillRelayStuckBadgeProps): ReactElement | null {
  // Absence and not-escalated are both "render nothing", but they are different
  // facts and only the backend can tell them apart - so neither is asserted here.
  if (waybillRelay === null || !waybillRelay.stuck) {
    return null;
  }
  const description = describeWaybillRelayStuck(waybillRelay);
  return (
    // `StatusBadge` takes no `title`, and widening a primitive every surface
    // renders for one caller is the wrong trade — so the hover affordance sits
    // on a wrapper, the `.listing-cell__reason` precedent (#2231). The same
    // sentence is also real `sr-only` text rather than only a `title`, because
    // `title` is not reliably exposed by assistive tech.
    <span title={description}>
      <StatusBadge tone="error" withDot compact>
        Tracking not sent
        <span className="sr-only"> — {description}</span>
      </StatusBadge>
    </span>
  );
}
