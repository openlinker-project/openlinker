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
import type { OrderEditedTotals } from '../api/order-edit.types';
import type { ParsedOrderTotals } from '../api/order-snapshot.schema';

interface OrderTotalsPanelProps {
  totals: ParsedOrderTotals;
  /**
   * Present only on an order edited in OpenLinker. There `totals.discountTotal`
   * is the COMBINED figure (channel + OpenLinker), so the channel-labelled row
   * must take the channel's own number from here (E-44).
   */
  editedTotals?: Pick<OrderEditedTotals, 'channelDiscountTotal' | 'combinedDiscountTotal'> | null;
}

export function OrderTotalsPanel({ totals, editedTotals }: OrderTotalsPanelProps): ReactElement {
  const currency = totals.currency;
  const snapshotDiscount = typeof totals.discountTotal === 'number' ? totals.discountTotal : 0;
  // An older payload without the channel figure cannot be split, so it keeps the
  // snapshot value on the channel row rather than inventing a share.
  const splittable = editedTotals != null && editedTotals.channelDiscountTotal !== undefined;
  const channelDiscount = splittable ? (editedTotals.channelDiscountTotal ?? 0) : snapshotDiscount;
  const combinedDiscount = splittable
    ? (editedTotals.combinedDiscountTotal ?? snapshotDiscount)
    : snapshotDiscount;
  const openLinkerDiscount = splittable ? Math.max(0, combinedDiscount - channelDiscount) : 0;
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
          {/* #2254 — this number is the CHANNEL's, and it will visibly disagree
              with the per-line rates: Allegro and Erli report zero here, so a 5%
              line rate can sit beside a tax total of 0.00. Nothing here computes
              a replacement, so the row keeps its snapshot value and says whose
              number it is rather than letting the reader assume it is OL's. */}
          <dt>
            Tax{' '}
            <span className="text-muted" style={{ fontWeight: 400 }}>
              as reported by the channel
            </span>
          </dt>
          <dd className="mono-text">{formatAmount(totals.tax, currency)}</dd>
        </div>
      ) : null}
      {channelDiscount > 0 ? (
        <div className="order-totals__row" data-testid="order-totals-discount">
          <dt>
            Discount{' '}
            <span className="text-muted" style={{ fontWeight: 400 }}>
              as reported by the channel
            </span>
          </dt>
          <dd className="mono-text">{`−${formatAmount(channelDiscount, currency)}`}</dd>
        </div>
      ) : null}
      {openLinkerDiscount > 0 ? (
        <div className="order-totals__row" data-testid="order-totals-openlinker-discount">
          <dt>Discount in OpenLinker</dt>
          <dd className="mono-text">{`−${formatAmount(openLinkerDiscount, currency)}`}</dd>
        </div>
      ) : null}
      <div className="order-totals__row order-totals__row--total">
        <dt>Total</dt>
        <dd className="mono-text">{formatAmount(totals.total, currency)}</dd>
      </div>
    </dl>
  );
}
