/**
 * Stock-at-risk Callout (#2350, story I6)
 *
 * The order-detail statement of a reservation shortfall: which items are short,
 * by how much, and — crucially — that nothing was silently reduced.
 *
 * `warning`, not `error`: the order is at risk, not broken. Nothing failed and
 * nothing was lost, and reserving `error` for real failures is what keeps a red
 * callout meaning outstanding work.
 *
 * It renders NOTHING when there is nothing to report, and in particular never a
 * "no shortfalls" reassurance — the loader catches to `[]` on failure, so
 * absence and failure are indistinguishable and only the presence of an episode
 * is a claim. See `stock-at-risk-copy.ts` for the rule.
 *
 * No remediation action: the operator's fix is off-system (buy stock, cancel,
 * contact the buyer), so offering a button here would imply a capability that
 * does not exist.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactNode } from 'react';
import { Alert } from '../../../shared/ui';
import { stockAtRiskCallout } from '../lib/stock-at-risk-copy';
import type { OrderReservationShortfall } from '../api/orders.types';

export interface StockAtRiskCalloutProps {
  shortfalls: readonly OrderReservationShortfall[] | undefined;
}

export function StockAtRiskCallout({ shortfalls }: StockAtRiskCalloutProps): ReactNode {
  const callout = stockAtRiskCallout(shortfalls);
  if (callout === null) return null;

  return (
    <Alert tone="warning" title={callout.title}>
      <p>{callout.body}</p>
      <ul className="stock-at-risk-callout__items">
        {callout.lines.map((line, index) => (
          <li key={`${String(index)}-${line}`}>{line}</li>
        ))}
      </ul>
    </Alert>
  );
}
