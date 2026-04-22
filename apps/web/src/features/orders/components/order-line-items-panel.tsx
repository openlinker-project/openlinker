/**
 * Order Line Items Panel
 *
 * Renders an order's parsed line items as a DataTable (product thumbnail + name/SKU,
 * qty, unit price, line total) with a subtotal/shipping/tax/total rollup. Currency
 * comes from the order totals; when totals are absent, prices render as plain
 * decimals rather than assuming a default currency.
 */
import type { ReactElement } from 'react';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { EmptyState } from '../../../shared/ui/feedback-state';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import type { ParsedOrderItem, ParsedOrderTotals } from '../api/order-snapshot.schema';

interface OrderLineItemsPanelProps {
  items: ParsedOrderItem[];
  totals?: ParsedOrderTotals;
}

function formatAmount(amount: number, currency: string | undefined): string {
  if (currency) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  }
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

export function OrderLineItemsPanel({
  items,
  totals,
}: OrderLineItemsPanelProps): ReactElement {
  const currency = totals?.currency;

  const columns: DataTableColumn<ParsedOrderItem>[] = [
    {
      id: 'product',
      header: 'Product',
      cell: (item) => (
        <span className="order-line-item__product">
          <ProductThumbnail
            name={item.name ?? item.sku ?? item.productId}
            src={item.imageUrl}
            size="sm"
          />
          <span className="order-line-item__product-info">
            {item.name ? (
              <span className="order-line-item__name">{item.name}</span>
            ) : null}
            {item.sku ? (
              <span className="order-line-item__sku mono-text">{item.sku}</span>
            ) : (
              <span className="order-line-item__sku mono-text text-muted">{item.productId}</span>
            )}
          </span>
        </span>
      ),
    },
    {
      id: 'qty',
      header: 'Qty',
      align: 'right',
      cell: (item) => <span>{item.quantity}</span>,
    },
    {
      id: 'unitPrice',
      header: 'Unit price',
      align: 'right',
      cell: (item) => (
        <span className="mono-text">{formatAmount(item.price, currency)}</span>
      ),
    },
    {
      id: 'lineTotal',
      header: 'Total',
      align: 'right',
      cell: (item) => (
        <span className="mono-text">{formatAmount(item.price * item.quantity, currency)}</span>
      ),
    },
  ];

  if (items.length === 0) {
    return (
      <EmptyState
        liveRegion="off"
        title="No line items"
        message="The order snapshot does not contain item details."
      />
    );
  }

  return (
    <div className="order-line-items">
      <DataTable
        caption="Order line items"
        columns={columns}
        rows={items}
        rowKey={(item) => item.id}
      />
      {totals ? (
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
      ) : null}
    </div>
  );
}
