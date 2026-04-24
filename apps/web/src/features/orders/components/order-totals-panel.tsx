/**
 * Order Totals Panel
 *
 * Financial rollup for an order — subtotal, shipping, tax, grand total.
 * Extracted out of `OrderLineItemsPanel` in #382 so the summary stays
 * visible when items fail to parse, and so the grand total can act as a
 * typographic anchor rather than living below a table.
 */
import type { ReactElement } from 'react';
import { formatAmount } from '../../../shared/format/format-amount';
import type { ParsedOrderTotals } from '../api/order-snapshot.schema';

interface OrderTotalsPanelProps {
  totals: ParsedOrderTotals;
}

export function OrderTotalsPanel({ totals }: OrderTotalsPanelProps): ReactElement {
  const currency = totals.currency;
  return (
    <dl className="order-totals">
      <div className="order-totals__row">
        <dt>Subtotal</dt>
        <dd className="mono-text">{formatAmount(totals.subtotal, currency)}</dd>
      </div>
      {totals.shipping > 0 ? (
        <div className="order-totals__row">
          <dt>Shipping</dt>
          <dd className="mono-text">{formatAmount(totals.shipping, currency)}</dd>
        </div>
      ) : null}
      {totals.tax > 0 ? (
        <div className="order-totals__row">
          <dt>Tax</dt>
          <dd className="mono-text">{formatAmount(totals.tax, currency)}</dd>
        </div>
      ) : null}
      <div className="order-totals__row order-totals__row--total">
        <dt>Total</dt>
        <dd className="mono-text">{formatAmount(totals.total, currency)}</dd>
      </div>
    </dl>
  );
}
