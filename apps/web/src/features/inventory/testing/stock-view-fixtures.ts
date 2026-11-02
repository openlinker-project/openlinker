/**
 * Stock view fixtures
 *
 * One realistic `StockViewVariant` and `StockView`, shared by the specs that
 * render the product page's stock figures. Field names are the API's own
 * (`StockViewResponseDto`), never invented, so a spec that branches on a field
 * the wire does not carry fails here rather than in production.
 *
 * @module apps/web/src/features/inventory/testing
 */
import type { StockView, StockViewVariant } from '../api/inventory.types';

export function stockVariantFixture(
  overrides: Partial<StockViewVariant> & { productVariantId: string; sku: string },
): StockViewVariant {
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
      {
        orderRecordId: 'o1',
        orderNumber: 'ALG-1',
        quantity: 3,
        atpEffect: 'published',
        expiresAt: '2026-10-01T00:00:00.000Z',
      },
      {
        orderRecordId: 'o2',
        orderNumber: 'ALG-2',
        quantity: 1,
        atpEffect: 'diagnostic',
        expiresAt: '2026-10-01T00:00:00.000Z',
      },
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

export function stockViewFixture(variants: StockViewVariant[]): StockView {
  return {
    productId: 'p1',
    productName: 'Kubek',
    productSku: 'KCN',
    staleSyncThreshold: { hours: 6, ms: 21_600_000, source: 'default' },
    channelsStatus: 'ok',
    variants,
    generatedAt: '2026-09-26T08:53:00.000Z',
  };
}
