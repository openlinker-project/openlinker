/**
 * Order Phase Badge (#2310)
 *
 * Renders an order's derived lifecycle phase (#2305/#2307) as a `StatusBadge`,
 * BESIDE the health badge on the list row and the detail header — never instead
 * of it. The two are orthogonal partitions (ADR-059): health answers "is
 * something wrong", the phase answers "what stage is it at".
 *
 * Renders nothing when the phase is absent or unrecognised (a payload predating
 * #2309). Every known phase always renders, including the three derived from
 * `fulfillmentState` that the Shipment column also describes — suppressing those
 * would make an absent badge ambiguous with an old payload.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import { StatusBadge } from '../../../shared/ui/status-badge';
import { phaseBadge } from '../lib/order-lifecycle-phase';

interface OrderPhaseBadgeProps {
  /** The row/detail `lifecyclePhase`; unknown or absent renders nothing. */
  phase: string | null | undefined;
  /**
   * A channel-reported lifecycle label, rendered verbatim for the
   * `vendor_authoritative` phase. No `OrderRecord` field supplies this yet
   * (Wave 4); the prop is the seam.
   */
  vendorLabel?: string | null;
  /** Compact badge for a table row / card badge-row; the detail header is not. */
  compact?: boolean;
}

export function OrderPhaseBadge({
  phase,
  vendorLabel,
  compact = false,
}: OrderPhaseBadgeProps): ReactElement | null {
  const badge = phaseBadge(phase, vendorLabel);
  if (!badge) return null;
  const element = (
    <StatusBadge tone={badge.tone} withDot compact={compact}>
      {badge.label}
    </StatusBadge>
  );
  // `StatusBadge` takes no `title`, so the attribution rides on a wrapper — and
  // it is also written out for a screen reader, because "who said this" is the
  // load-bearing half of a verbatim channel label, not a hover nicety.
  if (!badge.attribution) return element;
  return (
    <span className="order-phase-badge" title={badge.attribution}>
      {element}
      <span className="sr-only">{` — ${badge.attribution}`}</span>
    </span>
  );
}
