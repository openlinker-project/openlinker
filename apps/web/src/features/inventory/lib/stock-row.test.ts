import { describe, expect, it } from 'vitest';
import { stockVariantFixture } from '../testing/stock-view-fixtures';
import { buildStockRows, deriveRowStatus, VIEWER_STOCK_HINT, type BuildStockRowsInput, type StockRowModel } from './stock-row';

const variant = { id: 'v1', sku: 'KCN-WHT', attributes: null };

function build(overrides: Partial<BuildStockRowsInput> & { stock?: ReturnType<typeof stockVariantFixture> }): StockRowModel {
  const { stock, ...rest } = overrides;
  const rows = buildStockRows({
    variants: [variant],
    inventoryItems: [],
    stockByVariant: stock ? new Map([['v1', stock]]) : null,
    pending: false,
    restricted: false,
    canAdjust: true,
    fallbackMasterName: null,
    ...rest,
  });
  return rows.get('v1')!;
}

describe('buildStockRows', () => {
  it('should mark a row loading while the stock view is pending and keep the master count from inventory', () => {
    const row = build({
      pending: true,
      inventoryItems: [
        { id: 'i1', productId: 'p', productVariantId: 'v1', availableQuantity: 9, reservedQuantity: 1, locationId: null, updatedAt: '', productName: null, productSku: null, productImageUrl: null },
      ],
    });
    expect(row.state).toBe('loading');
    expect(row.masterAvailable).toBe(9);
  });

  it('should treat an unknown available to sell as unknown, never as zero', () => {
    const row = build({
      stock: stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT', availableToPromise: null, provenance: 'unknown', heldCounted: null }),
    });
    expect(row.state).toBe('unknown');
    expect(deriveRowStatus(row)).toEqual({ kind: 'not-known' });
    expect(row.adjustHint).toBe('Available again once OpenLinker can read the count.');
  });

  it('should name the master from the positions, falling back to the product source and then to a plain label', () => {
    const stock = stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT', positions: [] });
    expect(build({ stock, fallbackMasterName: 'Shop A' }).masterName).toBe('Shop A');
    expect(build({ stock }).masterName).toBe('the master');
    expect(build({ stock: stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT' }), fallbackMasterName: 'Shop A' }).masterName).toBe('PrestaShop');
  });

  it('should keep naming the shop for a variant it stopped reporting', () => {
    const base = stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT' }).positions[0]!;
    const row = build({
      stock: stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT', livePositionCount: 0, positions: [{ ...base, isStale: true }] }),
    });
    expect(row.state).toBe('staled');
    expect(row.masterName).toBe('PrestaShop');
    expect(deriveRowStatus(row)).toEqual({ kind: 'missing' });
    expect(row.adjustHint).toBe('PrestaShop no longer reports this variant.');
  });

  it('should refuse adjusting for two locations and for two shops, each with its own reason', () => {
    const base = stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT' }).positions[0]!;
    const twoLocations = build({
      stock: stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT', livePositionCount: 2, positions: [base, { ...base, locationId: 'loc2' }] }),
    });
    expect(twoLocations.multiLocation).toBe(true);
    expect(twoLocations.multiSource).toBe(false);
    expect(twoLocations.adjustHint).toBe('This variant is in 2 locations. Correct it in PrestaShop.');

    const twoShops = build({
      stock: stockVariantFixture({
        productVariantId: 'v1',
        sku: 'KCN-WHT',
        livePositionCount: 2,
        positions: [base, { ...base, locationId: null, sourceConnectionId: 'conn_woo', sourceConnectionName: 'WooCommerce' }],
      }),
    });
    expect(twoShops.multiSource).toBe(true);
    expect(twoShops.masterName).toBe('PrestaShop + WooCommerce');
    expect(twoShops.adjustHint).toBe('Two shops count this variant. Correct it in the shop that should own it.');
  });

  it('should give a session without write access the viewer hint first', () => {
    const row = build({ canAdjust: false, stock: stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT' }) });
    expect(row.adjustHint).toBe(VIEWER_STOCK_HINT);
  });
});

describe('deriveRowStatus', () => {
  it('should band what can be sold into in stock, low stock and out of stock', () => {
    const kinds = [20, 5, 0].map((atp) =>
      deriveRowStatus(build({ stock: stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT', availableToPromise: atp, heldCounted: 0, masterAvailable: 20 }) })).kind,
    );
    expect(kinds).toEqual(['in-stock', 'low-stock', 'out-of-stock']);
  });

  it('should say short by N when more is reserved than the master holds, not out of stock', () => {
    const row = build({ stock: stockVariantFixture({ productVariantId: 'v1', sku: 'KCN-WHT', masterAvailable: 2, heldCounted: 5, availableToPromise: 0 }) });
    expect(deriveRowStatus(row)).toEqual({ kind: 'short', by: 3 });
  });
});
