/**
 * Order Packed Tick
 *
 * The operator "packed" fact on one order row, rendered identically by the
 * desktop shipment cell and the mobile card — the shape `OrderInvoicingCell`
 * established after the hand-duplicated desktop/mobile ternaries drifted apart.
 *
 * It is a TICK, not a badge (#2081): the row already carries four badge
 * vocabularies (fulfillment, SLA, payment, invoicing) and packed is a position
 * in a workflow rather than a state anyone reconciles against. For the same
 * reason colour is never the only signal — the glyph and a text label carry it,
 * so the fact survives a monochrome or colour-blind reading.
 *
 * Unpacked renders `emptyFallback`, which the desktop stack passes as `null`:
 * not-yet-packed is the ordinary row, and a placeholder on every one of them
 * would be noise. The mobile fact list passes "—" instead, because a labelled
 * `<dd>` may not be empty.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactNode } from 'react';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { formatDateTime } from '../../../shared/format/format-date';

export interface OrderPackedTickProps {
  /** `undefined` (older payload) and `null` (never packed) mean the same here. */
  packedAt: string | null | undefined;
  /**
   * `stack` lets the parent's `orders-cell-stack` lay the tick out vertically
   * (desktop); `row` wraps it so a `<dd>` still receives a single child
   * (mobile). Layout only — the content is identical.
   */
  layout: 'stack' | 'row';
  /** Rendered when the order is not packed. */
  emptyFallback: ReactNode;
}

export function OrderPackedTick({
  packedAt,
  layout,
  emptyFallback,
}: OrderPackedTickProps): ReactNode {
  if (!packedAt) return emptyFallback;

  // `aria-label` alongside `title` (the #2100 pairing): `title` alone is
  // unreachable by keyboard, unreliable in screen readers on a role-less span,
  // and absent on touch — so the absolute instant is stated both ways. The
  // relative time beside it is decorative duplication for a screen reader,
  // hence `aria-hidden`.
  const absolute = formatDateTime(packedAt);
  const content = (
    <span
      className="orders-packed-tick"
      title={`Packed ${absolute}`}
      aria-label={`Packed ${absolute}`}
    >
      <span className="orders-packed-tick__mark" aria-hidden="true">
        ✓
      </span>{' '}
      <span className="orders-packed-tick__label">Packed</span>{' '}
      <TimeDisplay
        className="text-muted orders-cell-sub"
        iso={packedAt}
        format="relative"
        aria-hidden="true"
      />
    </span>
  );

  return layout === 'row' ? <span className="ds-row">{content}</span> : content;
}
