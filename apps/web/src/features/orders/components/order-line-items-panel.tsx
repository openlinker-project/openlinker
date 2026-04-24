/**
 * Order Line Items Panel
 *
 * Renders an order's parsed line items as a DataTable (product thumbnail +
 * name/SKU, qty, unit price, line total). The financial rollup lives in a
 * sibling `OrderTotalsPanel` (split in #382) so the summary stays visible
 * when items fail to parse.
 */
import type { ReactElement } from 'react';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { EmptyState } from '../../../shared/ui/feedback-state';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import { formatAmount } from '../../../shared/format/format-amount';
import type { ParsedOrderItem, ParsedOrderTotals } from '../api/order-snapshot.schema';

interface OrderLineItemsPanelProps {
  items: ParsedOrderItem[];
  /**
   * Only used for per-line price formatting. Totals are rendered separately
   * by `OrderTotalsPanel`.
   */
  totals?: ParsedOrderTotals;
}

export function OrderLineItemsPanel({ items, totals }: OrderLineItemsPanelProps): ReactElement {
  const currency = totals?.currency;

  const columns: DataTableColumn<ParsedOrderItem>[] = [
    {
      id: 'product',
      header: 'Product',
      cell: (item) => (
        <span className="order-line-item__product">
          <ProductThumbnail
            name={item.name ?? item.sku ?? item.productId ?? item.id}
            src={item.imageUrl}
            size="sm"
          />
          <span className="order-line-item__product-info">
            {item.name ? (
              <span className="order-line-item__name">{item.name}</span>
            ) : null}
            {item.sku ? (
              <span className="order-line-item__sku mono-text">{item.sku}</span>
            ) : item.productId ? (
              <span className="order-line-item__sku mono-text text-muted">{item.productId}</span>
            ) : (
              <span className="order-line-item__sku mono-text text-muted">{item.id}</span>
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
    </div>
  );
}
