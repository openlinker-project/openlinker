/**
 * BulkWizard pure-reducer tests (#792 / #1741)
 *
 * Pins `mergeResolveOutcomes`: per-variant resolve outcomes are folded into each
 * row's `variants[]` by variant id, preserving operator overrides; rows without
 * a matching outcome keep their identity.
 */
import { describe, expect, it } from 'vitest';
import { mergeResolveOutcomes } from './bulk-wizard';
import type { BulkResolveOutcome, BulkResolveVariantOutcome } from './bulk-resolve-step';
import type { BulkVariantRow, BulkWizardRow } from './bulk-wizard.types';
import type { Product, ProductVariant } from '../../../products';

function makeVariantRow(id: string, over: Partial<BulkVariantRow> = {}): BulkVariantRow {
  const variant = {
    id,
    productId: 'prod_1',
    sku: id,
    attributes: { Rozmiar: 'M' },
    ean: '5901234567897',
    gtin: null,
    price: 39,
  } as unknown as ProductVariant;
  return {
    variantId: id,
    variant,
    ean: variant.ean,
    distinguishingAttributes: variant.attributes,
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

function variantOutcome(
  variantId: string,
  partial: Partial<BulkResolveVariantOutcome> = {},
): BulkResolveVariantOutcome {
  return {
    variantId,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    masterPrice: null,
    masterStock: null,
    masterCurrency: null,
    categoryCandidates: [],
    ean: null,
    ...partial,
  };
}

function outcome(productId: string, variants: BulkResolveVariantOutcome[]): BulkResolveOutcome {
  return { productId, variants };
}

describe('mergeResolveOutcomes', () => {
  it('folds per-variant resolve fields into the matching variant row', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('ol_variant_1')])];
    const next = mergeResolveOutcomes(rows, [
      outcome('prod_1', [
        variantOutcome('ol_variant_1', {
          blockers: ['no-match'],
          resolvedCategoryId: 'cat-A',
          resolvedProductCardId: 'card-A',
          masterStock: 3,
          masterPrice: 12,
          masterCurrency: 'PLN',
        }),
      ]),
    ]);

    expect(next[0].variants[0]).toMatchObject({
      blockers: ['no-match'],
      resolvedCategoryId: 'cat-A',
      resolvedProductCardId: 'card-A',
      masterStock: 3,
    });
  });

  it('preserves each variant operator override across a re-resolve', () => {
    const rows = [
      makeRow('prod_1', [
        makeVariantRow('ol_variant_1', { override: { overrides: { title: 'Kept' } } }),
      ]),
    ];
    const next = mergeResolveOutcomes(rows, [
      outcome('prod_1', [variantOutcome('ol_variant_1', { masterStock: 9 })]),
    ]);
    expect(next[0].variants[0].override.overrides?.title).toBe('Kept');
    expect(next[0].variants[0].masterStock).toBe(9);
  });

  it('leaves a row with no matching outcome unchanged', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('ol_variant_1')])];
    const next = mergeResolveOutcomes(rows, [outcome('prod_2', [])]);
    expect(next[0]).toBe(rows[0]);
  });
});
