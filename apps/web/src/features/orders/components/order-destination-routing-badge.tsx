/**
 * Order Destination-Routing Badge (#2703 / #2704)
 *
 * Renders why a routing decision left an order's destination fan-out narrowed,
 * as a `StatusBadge`, from ONE component used by both the desktop row and the
 * mobile card.
 *
 * **Why the list needs it at all.** On a row, an order with no destination rows
 * reads "No destinations" whatever the cause - which is the conflation #2703 set
 * out to remove: "the router sent this nowhere" (a decision), "its routed
 * destination is disabled" (a fault) and "nothing is configured" (a state) are
 * three different things for the operator. The detail page already says which;
 * this puts the same answer on the row.
 *
 * **It belongs to the STATUS group**, beside health and never inside it:
 * `OrderHealthValues` is a partition whose values sum to the KPI cards, so a
 * routing value there would double-count or hide a sync failure (the placement
 * rule the hold and stock-at-risk badges follow).
 *
 * **Tone comes from the vocabulary, not from this file.** A reason in
 * `DESTINATION_ROUTING_ATTENTION_REASONS` is a fault or a misconfiguration and
 * renders as a warning; `routed-to-no-destination` is a working router making a
 * decision and renders neutrally, which is also why the filter chip never counts
 * it - the badge is its only list signal.
 *
 * Renders nothing for an absent or UNRECOGNISED reason (a value written by a
 * newer release and then rolled back): `resolveDestinationRoutingCopy` declines
 * to invent a label, and a confident wrong sentence is worse than none.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import { StatusBadge } from '../../../shared/ui/status-badge';
import {
  DESTINATION_ROUTING_ATTENTION_REASONS,
  isDestinationRoutingBlockReason,
  resolveDestinationRoutingCopy,
} from '../lib/destination-routing-copy';

interface OrderDestinationRoutingBadgeProps {
  /** The row's `destinationRoutingBlockReason`; absent or unknown renders nothing. */
  reason: string | null | undefined;
  /** Compact badge for a table row / card badge-row. */
  compact?: boolean;
}

export function OrderDestinationRoutingBadge({
  reason,
  compact = false,
}: OrderDestinationRoutingBadgeProps): ReactElement | null {
  const copy = resolveDestinationRoutingCopy(reason);
  if (copy === null) return null;

  const needsAttention =
    isDestinationRoutingBlockReason(reason) && DESTINATION_ROUTING_ATTENTION_REASONS.includes(reason);

  return (
    // `StatusBadge` takes no `title`, so the hint rides on a wrapper and is also
    // written out for a screen reader: WHY the order was routed this way is the
    // load-bearing half of the badge, not a hover nicety.
    <span className="order-destination-routing-badge" title={copy.hint}>
      <StatusBadge tone={needsAttention ? 'warning' : 'neutral'} withDot compact={compact}>
        {copy.label}
      </StatusBadge>
      <span className="sr-only">{` - ${copy.hint}`}</span>
    </span>
  );
}
