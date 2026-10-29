import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { StockView, StockViewVariant } from '../api/inventory.types';
import { buildStockRows } from '../lib/stock-row';
import { stockVariantFixture, stockViewFixture } from '../testing/stock-view-fixtures';
import { StockAlerts } from './stock-alerts';

afterEach(cleanup);

const variants = [
  { id: 'v1', sku: 'KCN-WHT', attributes: null },
  { id: 'v2', sku: 'KCN-GRY', attributes: null },
];

function renderAlerts(options: {
  stock?: StockViewVariant[];
  pending?: boolean;
  restricted?: boolean;
  canAdjust?: boolean;
  masterConnectionId?: string;
  onRetry?: () => void;
}): void {
  const view: StockView | null = options.stock ? stockViewFixture(options.stock) : null;
  const rows = buildStockRows({
    variants,
    inventoryItems: [],
    stockByVariant: view ? new Map(view.variants.map((v) => [v.productVariantId, v])) : null,
    pending: options.pending ?? false,
    restricted: options.restricted ?? false,
    canAdjust: options.canAdjust ?? true,
    fallbackMasterName: null,
  });
  renderWithProviders(
    <StockAlerts
      rows={rows}
      view={view}
      restricted={options.restricted ?? false}
      pending={options.pending ?? false}
      canAdjust={options.canAdjust ?? true}
      onRetry={options.onRetry ?? vi.fn()}
      masterConnectionId={options.masterConnectionId}
    />,
    {
      apiClient: createMockApiClient({
        connections: {
          list: vi.fn().mockResolvedValue([
            { id: 'conn_ps', name: 'PrestaShop - Ceramika Nowak', platformType: 'prestashop', status: 'active', adapterKey: 'prestashop.webservice.v1', config: {}, createdAt: '2026-01-15T10:00:00.000Z', updatedAt: '2026-01-15T10:00:00.000Z' },
          ]),
        },
      }),
    },
  );
}

const pair = (overrides: Partial<Omit<StockViewVariant, 'sku' | 'productVariantId'>> = {}): StockViewVariant[] => [
  stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT', ...overrides }),
  stockVariantFixture({ productVariantId: 'v2', sku: 'KCN-GRY', ...overrides }),
];

describe('StockAlerts', () => {
  it('should offer Try again when the stock is not known and call back on click', async () => {
    const onRetry = vi.fn();
    renderAlerts({ stock: pair({ availableToPromise: null, provenance: 'unknown', heldCounted: null }), onRetry });

    expect(await screen.findByTestId('stock-unknown-alert')).toHaveTextContent("isn't known right now");
    await userEvent.click(screen.getByTestId('stock-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('should show a viewer notice instead of hiding that stock can be changed', () => {
    renderAlerts({ stock: pair(), canAdjust: false });
    expect(screen.getByTestId('stock-viewer-notice')).toHaveTextContent('Ask an admin or operator to change stock.');
  });

  it('should show an access notice, never a retry, for a role that may not read the stock view', () => {
    renderAlerts({ restricted: true });
    expect(screen.getByTestId('stock-restricted-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('stock-unknown-alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stock-retry')).not.toBeInTheDocument();
  });

  it('should flag a stale sync with how long and what OpenLinker has not sent since', async () => {
    renderAlerts({ stock: pair({ isStaleSync: true, stalenessMs: 7 * 3_600_000 }) });

    const alert = await screen.findByTestId('stock-stale-alert');
    expect(alert).toHaveTextContent("Stock hasn't been refreshed for 7 h");
    expect(alert).toHaveTextContent("hasn't sent your channels a new number since then");
    expect(screen.getByTestId('stock-stale-open-connection')).toHaveAttribute('href', '/connections/conn_ps');
    expect(await screen.findByText(/PrestaShop - Ceramika Nowak last answered/)).toBeInTheDocument();
  });

  it('should show the multi-location banner for a variant kept in more than one place', () => {
    const base = stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT' }).positions[0]!;
    renderAlerts({
      stock: [
        stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT', livePositionCount: 2, positions: [base, { ...base, locationId: 'loc2' }] }),
        stockVariantFixture({ productVariantId: 'v2', sku: 'KCN-GRY' }),
      ],
    });
    expect(screen.getByTestId('stock-multi-location-alert')).toHaveTextContent('KCN-WHT is kept in more than one location');
    expect(screen.queryByTestId('stock-multi-source-alert')).not.toBeInTheDocument();
  });

  it('should show the two-shops banner naming both connections when positions come from two connections', () => {
    const base = stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT' }).positions[0]!;
    renderAlerts({
      stock: [
        stockVariantFixture({
          productVariantId: 'v1',
          sku: 'KCN-WHT',
          livePositionCount: 2,
          positions: [base, { ...base, locationId: null, sourceConnectionId: 'conn_woo', sourceConnectionName: 'WooCommerce' }],
        }),
        stockVariantFixture({ productVariantId: 'v2', sku: 'KCN-GRY' }),
      ],
    });
    const banner = screen.getByTestId('stock-multi-source-alert');
    expect(banner).toHaveTextContent('KCN-WHT is counted by PrestaShop and WooCommerce');
    expect(screen.queryByTestId('stock-multi-location-alert')).not.toBeInTheDocument();
  });

  it('should show the empty state with the connection as the next step when nothing was ever reported', async () => {
    renderAlerts({
      masterConnectionId: 'conn_ps',
      stock: pair({ positions: [], livePositionCount: 0, masterAvailable: 0, availableToPromise: 0, heldCounted: 0 }),
    });
    expect(await screen.findByTestId('stock-empty-open-connection')).toHaveAttribute('href', '/connections/conn_ps');
    expect(screen.getByTestId('stock-empty')).toHaveTextContent('PrestaShop - Ceramika Nowak');
  });

  it('should show a loading note while the stock view is pending', () => {
    renderAlerts({ pending: true });
    expect(screen.getByTestId('stock-loading')).toHaveTextContent('Working out what you can sell for 2 variants');
  });
});
