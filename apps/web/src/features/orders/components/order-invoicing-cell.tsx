/**
 * Order Invoicing Cell
 *
 * The invoicing state of one order row, rendered identically by the desktop
 * table cell and the mobile card (#2100 review round 4).
 *
 * It exists because those two used to be hand-duplicated ternaries, and they
 * diverged from the rest of the system in the same way twice. The state is not
 * a choice of ONE thing to show — an order can legitimately carry both a
 * terminal invoice failure and a live reason why auto-issue never ran, and
 * `a ? invoicePill : b ? blockBadge : cta` makes the second unreachable behind
 * the first. Because the aggregate count and the `?invoicing=blocked` filter
 * have no invoice awareness, that turned the chip into a number whose rows
 * explained nothing — the silent decline ADR-041 §54 forbids, one surface down.
 *
 * The three parts are therefore independent:
 *  - the invoice pill renders whenever a record exists;
 *  - the block badge renders whenever `invoicingBlockedBadge` returns one (that
 *    helper owns the suppression rule, mirroring the backend gate's
 *    `InvoiceRecord.blocksIssuanceElsewhere`, so a document that plausibly
 *    exists already hides it here);
 *  - the "Issue invoice" CTA renders only with no invoice and nothing blocking,
 *    or for `trigger-model-manual`, where clicking IS the configured workflow.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { invoiceBadge, invoicingBlockedBadge, taxRateConflictBadge } from '../lib/order-row';
import type { ParsedOrderInvoice } from '../api/order-snapshot.schema';
import type {
  SalesDocumentGateBlockReasonValue,
  SalesDocumentUnresolvedReasonValue,
} from '../api/orders.types';

export interface OrderInvoicingCellProps {
  internalOrderId: string;
  /** `undefined` (snapshot carried no invoice) and `null` mean the same here. */
  invoice: ParsedOrderInvoice | null | undefined;
  blockReason: SalesDocumentGateBlockReasonValue | null | undefined;
  unresolvedReason: SalesDocumentUnresolvedReasonValue | null | undefined;
  /** No connection can issue an invoice ⇒ the CTA would go nowhere useful. */
  hasInvoicingCapability: boolean;
  /**
   * `stack` lets the parent's `orders-cell-stack` lay the parts out vertically
   * (desktop); `row` wraps them so a `<dd>` still receives a single child
   * (mobile). Layout only — the parts and their conditions are identical.
   */
  layout: 'stack' | 'row';
  /**
   * The shop and the channel named different rates on at least one line
   * (#2254). A FOURTH independent part, not a variant of the block badge:
   * `invoicingBlockedBadge` suppresses itself whenever an invoice plausibly
   * exists, and a conflict does not stop the invoice, so routing this through
   * it would make it unrenderable on exactly the rows it describes.
   */
  hasTaxRateConflict?: boolean;
  /** Rendered when there is nothing at all to say. */
  emptyFallback: ReactNode;
}

export function OrderInvoicingCell({
  internalOrderId,
  invoice,
  blockReason,
  unresolvedReason,
  hasInvoicingCapability,
  hasTaxRateConflict = false,
  layout,
  emptyFallback,
}: OrderInvoicingCellProps): ReactNode {
  const inv = invoice ? invoiceBadge(invoice) : null;
  const blocked = invoicingBlockedBadge(blockReason, unresolvedReason, invoice);
  const conflict = hasTaxRateConflict ? taxRateConflictBadge() : null;

  // An existing record — even a failed one — means the next step is Retry in the
  // invoice panel, not a fresh issue; so the CTA never sits beside an invoice
  // pill. `keepIssueAction` is true only for `trigger-model-manual`.
  const showCta = hasInvoicingCapability && !inv && (!blocked || blocked.keepIssueAction);

  if (!inv && !blocked && !conflict && !showCta) return emptyFallback;

  const cta = (
    <Link className="orders-row-cta" to={`/orders/${internalOrderId}#invoicing`}>
      <span className="orders-row-cta__plus" aria-hidden="true">
        +
      </span>{' '}
      Issue invoice
    </Link>
  );

  const parts = (
    <>
      {inv ? (
        <StatusBadge tone={inv.tone} withDot compact>
          {inv.label}
        </StatusBadge>
      ) : null}
      {blocked ? (
        // `aria-label` alongside `title` (#2100 review): the hint is the ONLY
        // statement of why on this surface, and `title` alone is unreachable by
        // keyboard, unreliable in screen readers on a role-less span, and absent
        // on touch. Same pairing the "est." ship-by marker uses, for the same
        // reason.
        <span title={blocked.hint} aria-label={`${blocked.label}: ${blocked.hint}`}>
          <StatusBadge tone={blocked.tone} withDot compact>
            {blocked.label}
          </StatusBadge>
        </span>
      ) : null}
      {conflict ? (
        // Same shape as the block badge's, and for the same reason: this hint is
        // the only statement of the fact on the list. Visible label plus the
        // wording repeated in a visually-hidden span (the listings page's
        // `RowBadge` pattern) - `aria-label` on a bare span is prohibited and
        // commonly dropped, and `title` alone is unreachable by keyboard and
        // absent on touch.
        <span title={conflict.hint}>
          <StatusBadge tone="conflict" withDot compact>
            {conflict.label}
          </StatusBadge>
          <span className="sr-only">
            {conflict.label}: {conflict.hint}
          </span>
        </span>
      ) : null}
      {showCta ? cta : null}
    </>
  );

  return layout === 'row' ? (
    <span className="ds-row" style={{ gap: 'var(--space-2)' }}>
      {parts}
    </span>
  ) : (
    parts
  );
}
