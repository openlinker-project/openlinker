import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OrderLineItemsPanel } from './order-line-items-panel';
import { renderWithProviders } from '../../../test/test-utils';
import type {
  ParsedOrderItem,
  ParsedOrderTotals,
} from '../api/order-snapshot.schema';

const items: ParsedOrderItem[] = [
  {
    id: 'ol_orderitem_1',
    productId: 'ol_product_a',
    quantity: 2,
    price: 10,
    sku: 'SKU-A',
    name: 'Widget A',
  },
  {
    id: 'ol_orderitem_2',
    productId: 'ol_product_b',
    quantity: 1,
    price: 25,
    sku: 'SKU-B',
    name: 'Widget B',
  },
];

const totals: ParsedOrderTotals = {
  subtotal: 45,
  tax: 0,
  shipping: 5,
  total: 50,
  currency: 'PLN',
};

describe('OrderLineItemsPanel', () => {
  afterEach(cleanup);

  it('renders the line items with product name, SKU, and computed line total', () => {
    renderWithProviders(<OrderLineItemsPanel items={items} totals={totals} />);

    expect(screen.getByText('Widget A')).toBeInTheDocument();
    expect(screen.getByText('SKU-A')).toBeInTheDocument();
    expect(screen.getByText('Widget B')).toBeInTheDocument();
    expect(screen.getByText('SKU-B')).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    // Header + 2 data rows
    expect(rows).toHaveLength(3);
  });

  it('does not render a totals rollup (moved to OrderTotalsPanel)', () => {
    const { container } = renderWithProviders(
      <OrderLineItemsPanel items={items} totals={totals} />,
    );

    // The `Total` column header still exists inside the table. The rollup — a
    // sibling <dl class="order-totals"> — must not.
    expect(screen.queryByText('Subtotal')).toBeNull();
    expect(container.querySelector('.order-totals')).toBeNull();
  });

  it('renders line items without assuming a currency when totals are absent', () => {
    renderWithProviders(<OrderLineItemsPanel items={items} />);

    expect(screen.getByText('Widget A')).toBeInTheDocument();
    expect(screen.queryByText(/PLN/)).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(screen.queryByText(/€/)).toBeNull();
  });

  it('renders the empty state when there are no items', () => {
    renderWithProviders(<OrderLineItemsPanel items={[]} />);
    expect(screen.getByText('No line items')).toBeInTheDocument();
  });

  it('falls back to productId then item id for the SKU line when SKU is absent', () => {
    const itemsMissingSku: ParsedOrderItem[] = [
      { id: 'ol_orderitem_noSku', productId: 'ol_product_x', quantity: 1, price: 5 },
      { id: 'ol_orderitem_noProduct', quantity: 1, price: 5 },
    ];
    renderWithProviders(<OrderLineItemsPanel items={itemsMissingSku} />);

    expect(screen.getByText('ol_product_x')).toBeInTheDocument();
    expect(screen.getByText('ol_orderitem_noProduct')).toBeInTheDocument();
  });

  it('renders a backfilled rate as estimated from catalogue, never as a live shop/channel read (#2440)', () => {
    const backfilledItems: ParsedOrderItem[] = [
      {
        id: 'ol_orderitem_backfilled',
        productId: 'ol_product_a',
        quantity: 1,
        price: 10,
        taxRate: '23',
        taxSource: 'backfill',
      },
    ];
    renderWithProviders(<OrderLineItemsPanel items={backfilledItems} />);

    expect(screen.getByText(/estimated from catalogue/)).toBeInTheDocument();
    expect(screen.queryByText(/from the shop/)).not.toBeInTheDocument();
    expect(screen.queryByText(/from the channel/)).not.toBeInTheDocument();
  });
});
