import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderLineItemsPanel } from './order-line-items-panel';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { Permission } from '../../../shared/auth/session.types';
import type { ParsedOrderItem } from '../api/order-snapshot.schema';
import type { OrderLineCost } from '../api/orders.types';

const items: ParsedOrderItem[] = [
  { id: 'i1', productId: 'p1', quantity: 2, price: 50, sku: 'KUB-1', name: 'Kubek' },
  { id: 'i2', productId: 'p2', quantity: 4, price: 50, sku: 'FIL-1', name: 'Filiżanka' },
  { id: 'i3', productId: 'p3', quantity: 4, price: 20, sku: 'SPO-1', name: 'Spodek' },
];

const base = {
  quantity: 1,
  netAmount: 100,
  unitCostNet: null,
  unitCostCurrency: null,
  costOfGoods: null,
  margin: null,
  netEligible: true,
  sku: null,
};
const lines: OrderLineCost[] = [
  {
    ...base,
    lineNumber: 0,
    productId: 'p1',
    variantId: 'v1',
    costState: 'recorded',
    unitCostNet: '22.8000',
    unitCostCurrency: 'PLN',
    costOfGoods: 45.6,
    margin: 35.69,
    gapReason: null,
  },
  {
    ...base,
    lineNumber: 1,
    productId: 'p2',
    variantId: 'v2',
    costState: 'not-recorded',
    gapReason: 'no-cost',
  },
  {
    ...base,
    lineNumber: 2,
    productId: 'p3',
    variantId: 'v3',
    costState: 'not-recorded',
    gapReason: 'cost-entered-after-sale',
  },
];

function render(opts: { permissions?: Permission[]; trackMargin?: boolean } = {}) {
  const listLineCosts = vi.fn().mockResolvedValue({ currency: 'PLN', lines });
  const apiClient = createMockApiClient({
    orders: { listLineCosts },
    analyticsSettings: {
      getSettings: vi.fn().mockResolvedValue({ trackMargin: opts.trackMargin ?? true }),
    },
  } as never);
  renderWithProviders(<OrderLineItemsPanel items={items} internalOrderId="ord-1" />, {
    apiClient,
    sessionAdapter: createAuthenticatedSessionAdapter({
      id: 'u',
      username: 'u',
      email: 'u@example.com',
      role: 'viewer',
      permissions: opts.permissions ?? ['orders:read'],
      analyticsConsent: true,
    }),
  });
  return { listLineCosts };
}

describe('OrderLineItemsPanel cost columns (#3588)', () => {
  afterEach(cleanup);

  it('should show the recorded cost and margin of a covered line', async () => {
    render();
    const table = await screen.findByTestId('order-items-cost-table');
    await waitFor(() => {
      expect(within(table).getByText(/45[.,]60/)).toBeInTheDocument();
    });
    expect(within(table).getByText(/35[.,]69/)).toBeInTheDocument();
  });

  it('should flag a line with no cost and link to the cost prices page', async () => {
    render();
    const row = await screen.findByTestId('order-line-no-cost');
    expect(within(row).getByText('Not recorded')).toBeInTheDocument();
    expect(within(row).getByText('Not in margin')).toBeInTheDocument();
    const link = await screen.findByTestId('order-line-add-cost');
    expect(link).toHaveAttribute('href', '/products/cost-prices');
    expect(link).toHaveTextContent('Add cost for 1 variant');
    expect(screen.getByTestId('order-line-cost-note')).toBeInTheDocument();
  });

  it('should explain a cost entered after the sale with a neutral badge', async () => {
    render();
    await screen.findByTestId('order-line-add-cost');
    expect(screen.getByTitle('Ordered before the cost was entered')).toBeInTheDocument();
  });

  it('should hide the cost columns when margin tracking is off', async () => {
    const { listLineCosts } = render({ trackMargin: false });
    await waitFor(() => {
      expect(screen.queryByText('Cost at order time')).toBeNull();
    });
    expect(screen.queryByTestId('order-items-cost-table')).toBeNull();
    expect(listLineCosts).not.toHaveBeenCalled();
  });

  it('should not show or request cost for a session without orders:read (packer)', async () => {
    const { listLineCosts } = render({ permissions: ['bench:write'] });
    await waitFor(() => {
      expect(screen.getByText('Kubek')).toBeInTheDocument();
    });
    expect(screen.queryByText('Cost at order time')).toBeNull();
    expect(listLineCosts).not.toHaveBeenCalled();
  });
});
