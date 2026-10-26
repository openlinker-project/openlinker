import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthenticatedSessionAdapter, createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { PermissionValues } from '../../../shared/auth/session.types';
import type { StockView, StockViewVariant } from '../api/inventory.types';
import { StockPanel, type StockPanelVariant } from './stock-panel';

afterEach(cleanup);

const variants: StockPanelVariant[] = [
  { id: 'v1', sku: 'KCN-WHT', attributes: { color: 'Biały' } },
  { id: 'v2', sku: 'KCN-GRY', attributes: { color: 'Szary' } },
];

function stockVariant(overrides: Partial<StockViewVariant> & { productVariantId: string; sku: string }): StockViewVariant {
  return {
    attributes: {},
    masterAvailable: 18,
    masterReserved: 2,
    availableToPromise: 15,
    provenance: 'computed',
    observedAt: '2026-09-26T08:41:00.000Z',
    stalenessMs: 720_000,
    olHeldNotReflected: null,
    heldCounted: 3,
    heldRecordedOnly: 1,
    livePositionCount: 1,
    isStaleSync: false,
    positions: [
      {
        locationId: 'loc1',
        locationName: 'MAIN',
        sourceConnectionId: 'conn_ps',
        sourceConnectionName: 'PrestaShop',
        isStale: false,
        availableQuantity: 18,
        reservedQuantity: 2,
        updatedAt: '2026-09-26T08:41:00.000Z',
      },
    ],
    holds: [
      { orderRecordId: 'o1', orderNumber: 'ALG-1', quantity: 3, atpEffect: 'published', expiresAt: '2026-10-01T00:00:00.000Z' },
      { orderRecordId: 'o2', orderNumber: 'ALG-2', quantity: 1, atpEffect: 'diagnostic', expiresAt: '2026-10-01T00:00:00.000Z' },
    ],
    channels: [
      {
        connectionId: 'conn_al',
        connectionName: 'Allegro',
        platformType: 'allegro',
        rule: { stockSafetyBuffer: 2, stockZeroThreshold: 0 },
        willPublish: { quantity: 13, provenance: 'computed' },
        channelShows: { quantity: null, observedAt: null },
      },
    ],
    ...overrides,
  };
}

function view(vs: StockViewVariant[]): StockView {
  return {
    productId: 'p1',
    productName: 'Kubek',
    productSku: 'KCN',
    staleSyncThreshold: { hours: 6, ms: 21_600_000, source: 'default' },
    channelsStatus: 'ok',
    variants: vs,
    generatedAt: '2026-09-26T08:53:00.000Z',
  };
}

function renderPanel(options: { stock?: StockView | Promise<StockView>; viewer?: boolean; reject?: boolean }): void {
  const stockView = options.reject
    ? vi.fn().mockRejectedValue(new Error('boom'))
    : vi.fn().mockReturnValue(options.stock ?? new Promise(() => undefined));
  const user = {
    id: 'u',
    username: 'u',
    email: null,
    role: options.viewer ? 'viewer' : 'admin',
    permissions: PermissionValues.filter((p) => !options.viewer || p !== 'inventory:write'),
    analyticsConsent: true,
  };
  renderWithProviders(
    <StockPanel
        productId="p1"
        variants={variants}
        inventoryItems={[]}
        canAdjust={!options.viewer}
        onAdjust={vi.fn()}
    />,
    {
      apiClient: createMockApiClient({ inventory: { stockView } }),
      sessionAdapter: createAuthenticatedSessionAdapter(user),
    },
  );
}

describe('StockPanel', () => {
  it('should show held counted and recorded-only as separate figures', async () => {
    renderPanel({
      stock: view([
        stockVariant({ productVariantId: 'v1', sku: 'KCN-WHT' }),
        stockVariant({ productVariantId: 'v2', sku: 'KCN-GRY', heldRecordedOnly: 0, holds: [] , heldCounted: 0, availableToPromise: 18}),
      ]),
    });
    const held = await screen.findByTestId('stock-held-KCN-WHT');
    expect(held).toHaveTextContent('3');
    expect(held).toHaveTextContent('+1 recorded only');
    expect(screen.getByTestId('stock-atp-KCN-WHT')).toHaveTextContent('15');
  });

  it('should never render an unknown available to promise as 0', async () => {
    renderPanel({
      stock: view([
        stockVariant({ productVariantId: 'v1', sku: 'KCN-WHT', availableToPromise: null, provenance: 'unknown', heldCounted: null, heldRecordedOnly: null, holds: null }),
        stockVariant({ productVariantId: 'v2', sku: 'KCN-GRY', availableToPromise: null, provenance: 'unknown', heldCounted: null, heldRecordedOnly: null, holds: null }),
      ]),
    });
    expect(await screen.findByTestId('stock-unknown-alert')).toBeInTheDocument();
    const atp = screen.getByTestId('stock-atp-KCN-WHT');
    expect(atp).toHaveTextContent('Unknown');
    expect(atp).not.toHaveTextContent(/^0/);
    expect(screen.getByTestId('stock-summary-atp')).toHaveTextContent('Unknown');
    expect(screen.getByTestId('stock-held-KCN-WHT')).toHaveTextContent("Couldn't read");
    expect(screen.getByTestId('stock-retry')).toBeInTheDocument();
  });

  it('should treat a failed stock view as unknown and offer a retry', async () => {
    renderPanel({ reject: true });
    expect(await screen.findByTestId('stock-unknown-alert')).toBeInTheDocument();
    expect(screen.getByTestId('stock-atp-KCN-WHT')).toHaveTextContent('Unknown');
  });

  it('should render a skeleton for available to promise while the stock view loads', () => {
    renderPanel({});
    expect(screen.getByTestId('stock-loading')).toBeInTheDocument();
    expect(within(screen.getByTestId('stock-atp-KCN-WHT')).queryByText(/\d/)).toBeNull();
    expect(screen.getByTestId('stock-master-KCN-WHT')).toBeInTheDocument();
  });

  it('should flag a stale sync with the threshold and the last update', async () => {
    renderPanel({
      stock: view([
        stockVariant({ productVariantId: 'v1', sku: 'KCN-WHT', isStaleSync: true, stalenessMs: 7 * 3_600_000 }),
        stockVariant({ productVariantId: 'v2', sku: 'KCN-GRY', isStaleSync: true, stalenessMs: 7 * 3_600_000 }),
      ]),
    });
    const alert = await screen.findByTestId('stock-stale-alert');
    expect(alert).toHaveTextContent('7 h');
    expect(alert).toHaveTextContent('6 h');
    expect(screen.getByTestId('stock-stale-open-connection')).toHaveAttribute('href', '/connections/conn_ps');
  });

  it('should label an all-stale position as stale and not counted', async () => {
    const stalePosition = stockVariant({ productVariantId: 'v1', sku: 'KCN-WHT' }).positions[0]!;
    renderPanel({
      stock: view([
        stockVariant({
          productVariantId: 'v1',
          sku: 'KCN-WHT',
          masterAvailable: 0,
          availableToPromise: 0,
          heldCounted: 0,
          livePositionCount: 0,
          positions: [{ ...stalePosition, isStale: true }],
        }),
        stockVariant({ productVariantId: 'v2', sku: 'KCN-GRY' }),
      ]),
    });
    expect(await screen.findByTestId('stock-master-KCN-WHT')).toHaveTextContent('Stale');
    expect(screen.getByTestId('stock-atp-KCN-WHT')).toHaveTextContent('Not counted');
    expect(screen.getByTestId('stock-adjust-KCN-WHT')).toBeDisabled();
  });

  it('should show the multi-location banner and refuse to hold across places', async () => {
    const position = stockVariant({ productVariantId: 'v1', sku: 'KCN-WHT' }).positions[0]!;
    renderPanel({
      stock: view([
        stockVariant({
          productVariantId: 'v1',
          sku: 'KCN-WHT',
          livePositionCount: 2,
          heldCounted: 0,
          holds: [],
          positions: [position, { ...position, locationId: 'loc2', locationName: 'OUTLET' }],
        }),
        stockVariant({ productVariantId: 'v2', sku: 'KCN-GRY' }),
      ]),
    });
    expect(await screen.findByTestId('stock-multi-location-alert')).toBeInTheDocument();
    expect(screen.getByTestId('stock-held-KCN-WHT')).toHaveTextContent("Can't hold - stock in 2 places");
    await userEvent.click(screen.getByTestId('stock-variant-toggle-KCN-WHT'));
    expect(screen.getByTestId('stock-positions-KCN-WHT')).toBeInTheDocument();
  });

  it('should show "Not seen yet" when the channel has no snapshot', async () => {
    renderPanel({
      stock: view([
        stockVariant({ productVariantId: 'v1', sku: 'KCN-WHT' }),
        stockVariant({ productVariantId: 'v2', sku: 'KCN-GRY' }),
      ]),
    });
    await userEvent.click(await screen.findByTestId('stock-variant-toggle-KCN-WHT'));
    const row = screen.getByTestId('stock-channel-KCN-WHT-allegro');
    expect(row).toHaveTextContent('Not seen yet');
    expect(row).toHaveTextContent('Keeps 2 back');
    expect(screen.getByTestId('stock-hold-ALG-1')).toHaveAttribute('href', '/orders/o1');
    expect(screen.getByTestId('stock-drawer-KCN-WHT')).toHaveTextContent('Recorded but not counted: ALG-2 (1)');
  });

  it('should disable Adjust stock with a hint for a viewer, not hide it', async () => {
    renderPanel({
      viewer: true,
      stock: view([
        stockVariant({ productVariantId: 'v1', sku: 'KCN-WHT' }),
        stockVariant({ productVariantId: 'v2', sku: 'KCN-GRY' }),
      ]),
    });
    const button = await screen.findByTestId('stock-adjust-KCN-WHT');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Only admins and operators can adjust stock.');
    expect(screen.getByTestId('stock-viewer-notice')).toBeInTheDocument();
  });

  it('should show the empty state for a known zero with no positions', async () => {
    renderPanel({
      stock: view([
        stockVariant({ productVariantId: 'v1', sku: 'KCN-WHT', positions: [], livePositionCount: 0, masterAvailable: 0, availableToPromise: 0, heldCounted: 0 }),
        stockVariant({ productVariantId: 'v2', sku: 'KCN-GRY', positions: [], livePositionCount: 0, masterAvailable: 0, availableToPromise: 0, heldCounted: 0 }),
      ]),
    });
    expect(await screen.findByTestId('stock-empty')).toBeInTheDocument();
  });
});
