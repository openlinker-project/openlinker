import { cleanup, screen, within } from '@testing-library/react';
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

  it('renders the totals rollup with subtotal, shipping, and total', () => {
    renderWithProviders(<OrderLineItemsPanel items={items} totals={totals} />);

    const rollup = screen.getByText('Subtotal').closest('dl');
    expect(rollup).not.toBeNull();
    const rollupEl = within(rollup!);
    expect(rollupEl.getByText('Subtotal')).toBeInTheDocument();
    expect(rollupEl.getByText('Shipping')).toBeInTheDocument();
    expect(rollupEl.getByText('Total')).toBeInTheDocument();
    // Tax is zero so should NOT render a Tax row
    expect(rollupEl.queryByText('Tax')).toBeNull();
  });

  it('renders line items without assuming a currency when totals are absent', () => {
    renderWithProviders(<OrderLineItemsPanel items={items} />);

    expect(screen.getByText('Widget A')).toBeInTheDocument();
    // No totals rollup
    expect(screen.queryByText('Subtotal')).toBeNull();
    // No PLN or other currency code should appear
    expect(screen.queryByText(/PLN/)).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(screen.queryByText(/€/)).toBeNull();
  });

  it('renders the empty state when there are no items', () => {
    renderWithProviders(<OrderLineItemsPanel items={[]} />);
    expect(screen.getByText('No line items')).toBeInTheDocument();
  });
});
