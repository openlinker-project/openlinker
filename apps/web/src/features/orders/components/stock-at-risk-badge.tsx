/**
 * Stock-at-risk Badge (#2350, story I6)
 *
 * The order-row signal that OpenLinker promised more stock than the master now
 * has, and this order is one the shortfall lands on.
 *
 * Three placement decisions come from `frontend-ui-style-guide.md § Order-row
 * signal placement (#2081)` rather than from taste:
 *
 * - **It is a badge in the STATUS group.** A shortfall is an exception, and the
 *   guide puts exceptions beside failure reasons. It is not a Money signal and
 *   not a Shipment signal, so it earns no new column.
 * - **It sits BESIDE order health, never inside it.** `OrderHealthValues` is a
 *   partition whose values must stay exhaustive and mutually exclusive so the
 *   KPI cards sum to the total; adding a shortfall value would double-count or
 *   hide a sync failure behind a stock one — the trap #2100 declined when it
 *   shipped a non-partitioning field instead of a sixth bucket.
 * - **It is inert.** The list displays, the detail page acts (rule 3), and this
 *   issue ships no inline remediation — the operator's fix is off-system.
 *
 * One renderer, two layouts — the `OrderInvoicingCell` contract, which exists
 * because a hand-duplicated desktop/mobile pair diverged twice. `layout` is
 * layout only; it never changes what is said.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactNode } from 'react';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { STOCK_AT_RISK_BODY, stockAtRiskBadge } from '../lib/stock-at-risk-copy';
import type { OrderReservationShortfall } from '../api/orders.types';

export interface StockAtRiskBadgeProps {
  /**
   * `undefined` and `[]` mean the same thing here, and that thing is "nothing
   * reported" — NOT "this order is fine". Both the detail loader and the list's
   * batched read catch to empty on failure, so nothing is rendered either way
   * and no reassurance is ever stated.
   */
  shortfalls: readonly OrderReservationShortfall[] | undefined;
  /** Layout only, exactly as on `OrderInvoicingCell`. */
  layout?: 'stack' | 'row';
  /**
   * Rendered when there is nothing to report.
   *
   * A prop rather than a call-site ternary, and for the reason this whole
   * slice exists: "when is there nothing to show" is the copy module's rule,
   * and a page that restates it can silently disagree with the badge. Same
   * contract as `OrderInvoicingCell.emptyFallback`.
   */
  emptyFallback?: ReactNode;
}

export function StockAtRiskBadge({
  shortfalls,
  layout = 'stack',
  emptyFallback = null,
}: StockAtRiskBadgeProps): ReactNode {
  const badge = stockAtRiskBadge(shortfalls);
  if (badge === null) return emptyFallback;

  const content = (
    // Visible label + `title` + a visually-hidden restatement — the corrected
    // pattern the tax-rate-conflict badge uses, NOT the older `aria-label`-on-a-
    // bare-span one beside it: `aria-label` on a role-less span is prohibited
    // and commonly dropped, while `title` alone is unreachable by keyboard and
    // absent on touch. The body sentence is the only statement of WHY on this
    // surface, so it must survive both.
    <span title={badge.title}>
      <StatusBadge tone={badge.tone} withDot compact>
        {badge.label}
      </StatusBadge>
      {/* The BODY only — the label is already rendered above, so repeating the
          whole title here would make assistive tech announce it twice. */}
      <span className="sr-only">{STOCK_AT_RISK_BODY}</span>
    </span>
  );

  return layout === 'row' ? (
    <span className="ds-row" style={{ gap: 'var(--space-2)' }}>
      {content}
    </span>
  ) : (
    content
  );
}
