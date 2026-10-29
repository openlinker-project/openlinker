/**
 * Destination-routing Callout (#2703 / #2704)
 *
 * The order-detail statement of how routing narrowed this order's destination
 * fan-out, including WHICH destinations could not be reached (the persisted
 * `detail`, connection ids and counts only). The sync cell cannot carry this:
 * it reads the reason only for an empty rollup, so a partially-resolved order
 * (some destination rows exist) would otherwise show "All destinations
 * reconciled" beside a reason saying it was not.
 *
 * Renders nothing for an absent or unrecognised reason, and nothing for a
 * routing DECISION (`routed-to-no-destination`) — that is not outstanding work,
 * and the sync cell already states it neutrally.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactNode } from 'react';
import { Alert } from '../../../shared/ui/alert';
import {
  DESTINATION_ROUTING_ATTENTION_REASONS,
  isDestinationRoutingBlockReason,
  resolveDestinationRoutingCopy,
} from '../lib/destination-routing-copy';

export interface DestinationRoutingCalloutProps {
  reason: string | null | undefined;
  detail: string | null | undefined;
}

export function DestinationRoutingCallout({
  reason,
  detail,
}: DestinationRoutingCalloutProps): ReactNode {
  const copy = resolveDestinationRoutingCopy(reason);
  if (copy === null || !isDestinationRoutingBlockReason(reason)) return null;
  if (!DESTINATION_ROUTING_ATTENTION_REASONS.includes(reason)) return null;

  return (
    <Alert tone="warning" title={copy.label}>
      <p>{copy.hint}</p>
      {detail ? <p className="mono-text">{detail}</p> : null}
    </Alert>
  );
}
