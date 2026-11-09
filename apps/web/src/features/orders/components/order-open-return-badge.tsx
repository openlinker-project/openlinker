/**
 * Order Open-Return Badge (#2998)
 *
 * The Status-group badge for an order carrying an OPEN return. Placement
 * follows `frontend-ui-style-guide.md § Order-row signal placement (#2081)`,
 * the `StockAtRiskBadge` precedent: a badge in the STATUS group, beside order
 * health rather than inside it (`OrderHealthValues` is a partition summing to
 * the KPI cards — a return value there would double-count or hide a sync
 * failure behind a return one).
 *
 * **Neutral tone.** A return is routine, not an alarm — unlike the shortfall
 * badge beside it, this is not attention-worthy on its own; the returns list's
 * own `all_open` segment (#2378) treats it the same way.
 *
 * One renderer, two layouts — the `OrderInvoicingCell` / `StockAtRiskBadge`
 * contract, so a hand-duplicated desktop/mobile pair cannot diverge.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactNode } from 'react';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { interpolate, useMessages, type Messages, type ResolvedCopy } from '../../../shared/i18n';
import type { OrderOpenReturn } from '../api/orders.types';

type OpenReturnBadgeCopy = ResolvedCopy<Messages['orders']>['openReturnBadge'];

export interface OrderOpenReturnBadgeProps {
  /**
   * `undefined` means "nothing reported" — the batched read is best-effort
   * and degrades to absent on failure, never a positive "no open return"
   * claim.
   */
  openReturn: OrderOpenReturn | undefined;
  layout?: 'stack' | 'row';
  emptyFallback?: ReactNode;
}

/**
 * Presentation label for the derived return stage (returns spec § 3.2), or the
 * raw value for a stage this build does not know.
 */
function stageLabel(stage: string, copy: OpenReturnBadgeCopy): string {
  return Object.prototype.hasOwnProperty.call(copy.stages, stage)
    ? copy.stages[stage as keyof OpenReturnBadgeCopy['stages']]
    : stage;
}

export function OrderOpenReturnBadge({
  openReturn,
  layout = 'stack',
  emptyFallback = null,
}: OrderOpenReturnBadgeProps): ReactNode {
  const copy = useMessages('orders').openReturnBadge;
  if (!openReturn || openReturn.count === 0) return emptyFallback;

  const stage = stageLabel(openReturn.stage, copy);
  const label =
    openReturn.count > 1 ? interpolate(copy.labelMany, { count: openReturn.count }) : copy.label;
  const title = interpolate(copy.title, { label, stage });

  const content = (
    <span title={title}>
      <StatusBadge tone="neutral" withDot compact>
        {label}
      </StatusBadge>
      <span className="sr-only">{stage}</span>
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
