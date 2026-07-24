/**
 * BulkShopReviewStep pure-helper tests (#1829)
 *
 * Pins `buildBulkShopPublishItems`: one `bulk-shop-publish` item per INCLUDED
 * variant, stock resolved from master availability + the batch stock policy,
 * price from the variant master price + the batch pricing policy, excluded
 * variants dropped, and a null resolved price omitted (shop builder falls back
 * to master server-side).
 */
import { describe, expect, it } from 'vitest';
import { buildBulkShopPublishItems } from './bulk-shop-review-step';
import type { BulkVariantRow, BulkWizardConfig, BulkWizardRow } from './bulk-wizard.types';
import type { Product, ProductVariant } from '../../../products';

function makeVariantRow(id: string, over: Partial<BulkVariantRow> = {}): BulkVariantRow {
  const variant = { id, productId: 'prod_1', sku: id } as unknown as ProductVariant;
  return {
    variantId: id,
    variant,
    ean: null,
    distinguishingAttributes: null,
    masterStock: null,
    masterPrice: 39,
    masterCurrency: 'PLN',
    included: true,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    categoryCandidates: [],
    override: {},
    ...over,
  };
}

function makeRow(productId: string, variants: BulkVariantRow[]): BulkWizardRow {
  return {
    productId,
    product: { id: productId, name: 'P', currency: 'PLN' } as unknown as Product,
    primaryVariant: variants[0]?.variant ?? null,
    variants,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    masterPrice: null,
    masterStock: null,
    masterCurrency: null,
    categoryCandidates: [],
    override: {},
  };
}

function config(over: Partial<BulkWizardConfig> = {}): BulkWizardConfig {
  return {
    connectionId: 'conn_shop',
    platformParams: {},
    currency: 'PLN',
    pricingPolicy: { mode: 'use-master' },
    stockPolicy: { mode: 'use-master' },
    publishImmediately: true,
    generateDescription: false,
    ...over,
  };
}

describe('buildBulkShopPublishItems', () => {
  it('emits one item per included variant with master-derived price + availability stock', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1'), makeVariantRow('v2')])];
    const items = buildBulkShopPublishItems(
      rows,
      config(),
      new Map([
        ['v1', 7],
        ['v2', 3],
      ]),
    );
    expect(items).toEqual([
      { internalVariantId: 'v1', stock: 7, price: { amount: 39, currency: 'PLN' } },
      { internalVariantId: 'v2', stock: 3, price: { amount: 39, currency: 'PLN' } },
    ]);
  });

  it('drops excluded variants', () => {
    const rows = [
      makeRow('prod_1', [makeVariantRow('v1'), makeVariantRow('v2', { included: false })]),
    ];
    const items = buildBulkShopPublishItems(rows, config(), new Map([['v1', 5]]));
    expect(items.map((i) => i.internalVariantId)).toEqual(['v1']);
  });

  it('applies flat stock + flat price policies', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1')])];
    const items = buildBulkShopPublishItems(
      rows,
      config({ stockPolicy: { mode: 'flat', value: 10 }, pricingPolicy: { mode: 'flat', amount: 99 } }),
      new Map(),
    );
    expect(items).toEqual([
      { internalVariantId: 'v1', stock: 10, price: { amount: 99, currency: 'PLN' } },
    ]);
  });

  it('omits price when master price is missing under use-master pricing', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1', { masterPrice: null })])];
    const items = buildBulkShopPublishItems(rows, config(), new Map([['v1', 4]]));
    expect(items).toEqual([{ internalVariantId: 'v1', stock: 4 }]);
    expect(items[0]).not.toHaveProperty('price');
  });

  it('sends 0 stock when no availability is known under use-master stock', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1')])];
    const items = buildBulkShopPublishItems(rows, config(), new Map());
    expect(items[0].stock).toBe(0);
  });
});
