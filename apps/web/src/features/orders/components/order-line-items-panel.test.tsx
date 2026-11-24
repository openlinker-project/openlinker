import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrderLineCostsState } from '../hooks/use-order-line-costs';
import { OrderLineItemsPanel } from './order-line-items-panel';
import { renderWithProviders } from '../../../test/test-utils';
import type {
  ParsedOrderItem,
  ParsedOrderTotals,
} from '../api/order-snapshot.schema';

const costState: { current: OrderLineCostsState } = {
  current: { enabled: false, status: 'loading', currency: null, lines: [], giftSlots: [] },
};
vi.mock('../hooks/use-order-line-costs', () => ({
  useOrderLineCosts: (): OrderLineCostsState => costState.current,
}));

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

  describe('bundle lines (#3624)', () => {
    const bundleLine: ParsedOrderItem = {
      id: 'L1',
      productId: 'p-set',
      quantity: 1,
      price: 64.99,
      sku: 'ZES-PORANNY',
      name: 'Zestaw poranny',
    };
    const bundleLines = [
      {
        lineId: 'L1',
        bundleVariantId: 'v-set',
        version: 1,
        olderComposition: false,
        components: [
          { lineId: 'L1~c:mug', variantId: 'mug', productId: 'p-mug', name: 'Kubek', sku: 'KUB-350-BI', quantity: 1, perUnit: 1 },
          { lineId: 'L1~c:coffee', variantId: 'coffee', productId: 'p-coffee', name: 'Kawa', sku: 'KAW-250-ETI', quantity: 1, perUnit: 1 },
        ],
      },
    ];

    it('should list the components under the bundle line, priced inside the bundle', () => {
      renderWithProviders(
        <OrderLineItemsPanel items={[bundleLine]} totals={totals} bundleLines={bundleLines} />,
      );
      expect(screen.getByTestId('order-bundle-lines')).toBeInTheDocument();
      const rows = screen.getAllByRole('row');
      // Header + bundle line + two components.
      expect(rows).toHaveLength(4);
      expect(screen.getByTestId('order-bundle-line-ZES-PORANNY')).toHaveTextContent('Bundle');
      expect(screen.getByTestId('order-bundle-line-KUB-350-BI')).toHaveTextContent('in the bundle price');
      expect(screen.queryByTestId('order-bundle-old-composition-note')).toBeNull();
    });

    describe('gift slot (#3934)', () => {
      const withGift = [
        {
          ...bundleLines[0],
          components: [
            ...bundleLines[0].components,
            {
              lineId: 'L1~c:spoon',
              variantId: 'spoon',
              productId: 'p-spoon',
              name: 'Lyzeczka',
              sku: 'LYZ-KAW',
              quantity: 1,
              perUnit: 1,
              giftSlot: true,
            },
          ],
        },
      ];

      it('should show the gift once, at 0.00, without a cost for a session that may not read costs', () => {
        costState.current = { enabled: false, status: 'loading', currency: null, lines: [], giftSlots: [] };
        renderWithProviders(
          <OrderLineItemsPanel items={[bundleLine]} totals={totals} bundleLines={withGift} />,
        );
        expect(screen.getAllByTestId('order-bundle-gift-mark-LYZ-KAW')).toHaveLength(1);
        const note = screen.getByTestId('order-bundle-gift-cost-LYZ-KAW');
        expect(note).toHaveTextContent('Customer pays');
        expect(note).not.toHaveTextContent('Costs you');
        expect(screen.getByTestId('order-bundle-line-KUB-350-BI')).not.toHaveTextContent('Gift');
      });

      it('should add what the gift costs you once the cost is known', () => {
        costState.current = {
          enabled: true,
          status: 'loaded',
          currency: 'PLN',
          lines: [],
          giftSlots: [
            { lineId: 'L1', componentLineId: 'L1~c:spoon', variantId: 'spoon', quantity: 1, totalCostNet: 3.9 },
          ],
        };
        renderWithProviders(
          <OrderLineItemsPanel items={[bundleLine]} totals={totals} bundleLines={withGift} />,
        );
        expect(screen.getByTestId('order-bundle-gift-cost-LYZ-KAW')).toHaveTextContent(
          /Customer pays.*Costs you/,
        );
        costState.current = { enabled: false, status: 'loading', currency: null, lines: [], giftSlots: [] };
      });
    });

    it('should say, in one sentence, that the order keeps the older composition', () => {
      renderWithProviders(
        <OrderLineItemsPanel
          items={[bundleLine]}
          totals={totals}
          bundleLines={[{ ...bundleLines[0], olderComposition: true }]}
        />,
      );
      expect(screen.getByTestId('order-bundle-old-composition-note')).toHaveTextContent(
        'composition from before the bundle was changed',
      );
    });

    it('should render an order without a bundle exactly as before', () => {
      renderWithProviders(<OrderLineItemsPanel items={items} totals={totals} bundleLines={[]} />);
      expect(screen.queryByTestId('order-bundle-lines')).toBeNull();
      expect(screen.getAllByRole('row')).toHaveLength(3);
    });
  });
});
