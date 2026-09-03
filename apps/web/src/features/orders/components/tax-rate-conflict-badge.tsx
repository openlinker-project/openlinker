/**
 * Tax-Rate Conflict Badge (#2254)
 *
 * One render of the shop-versus-channel rate disagreement, shared verbatim by
 * the desktop money cluster and the mobile order card.
 *
 * It exists as a component rather than as two inline renders because that is
 * exactly how the retired `OrderInvoicingCell` went wrong: its own comment
 * records that "this used to be a hand-duplicated parallel render path, and
 * the two diverged". The first draft of #2761 reintroduced the same shape and
 * the two copies had already drifted (desktop carried the `sr-only` hint,
 * mobile did not), so the screen-reader hint was silently missing on mobile.
 *
 * The badge is deliberately its OWN line beside the sales-document cell and is
 * never folded into it: a rate conflict does not stop the invoice, so it can be
 * true alongside any document state.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactNode } from 'react';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { taxRateConflictBadge } from '../lib/order-row';

export function TaxRateConflictBadge(): ReactNode {
  const { label, hint } = taxRateConflictBadge();
  return (
    <span title={hint}>
      <StatusBadge tone="conflict" withDot compact>
        {label}
      </StatusBadge>
      {/* Only the hint — `StatusBadge` already announces `label` as visible
          text, and a second sr-only copy of it would read as "Rate conflict.
          Rate conflict: …" (#2761 review). */}
      <span className="sr-only">{hint}</span>
    </span>
  );
}
