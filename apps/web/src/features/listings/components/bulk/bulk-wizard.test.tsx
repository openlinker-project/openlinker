/**
 * BulkWizard pure-reducer tests (#792 PR 3)
 *
 * Pins `mergeResolveOutcomes`: resolve outcomes are folded into rows by
 * productId; rows without a matching outcome keep their identity.
 */
import { describe, expect, it } from 'vitest';
import { mergeResolveOutcomes } from './bulk-wizard';
import { recomputeRowBlockers, selectBulkProductCardId } from './bulk-policy';
import type { BulkResolveOutcome } from './bulk-resolve-step';
import type { BulkWizardConfig, BulkWizardRow } from './bulk-wizard.types';
import type { ProductVariant } from '../../../products';

function makeRow(productId: string): BulkWizardRow {
  return {
    productId,
    product: null,
    primaryVariant: null,
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

function outcome(
  productId: string,
  partial: Partial<BulkResolveOutcome> = {},
): BulkResolveOutcome {
  return {
    productId,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    masterPrice: null,
    masterStock: null,
    masterCurrency: null,
    categoryCandidates: [],
    ...partial,
  };
}

describe('mergeResolveOutcomes', () => {
  it('folds resolve outcome fields into the matching row', () => {
    const rows = [makeRow('prod_1')];
    const next = mergeResolveOutcomes(rows, [
      outcome('prod_1', {
        blockers: [],
        resolvedCategoryId: 'cat-A',
        resolvedProductCardId: 'card-A',
        masterPrice: 12,
        masterStock: 3,
        masterCurrency: 'PLN',
        categoryCandidates: [],
      }),
    ]);

    expect(next[0]).toMatchObject({
      productId: 'prod_1',
      blockers: [],
      resolvedCategoryId: 'cat-A',
      resolvedProductCardId: 'card-A',
      masterPrice: 12,
      masterStock: 3,
      masterCurrency: 'PLN',
    });
  });

  it('records a matched category + method', () => {
    const next = mergeResolveOutcomes(
      [makeRow('prod_1')],
      [outcome('prod_1', { resolvedCategoryId: 'cat-A', resolutionMethod: 'auto_detect' })],
    );
    expect(next[0]).toMatchObject({
      blockers: [],
      resolvedCategoryId: 'cat-A',
      resolutionMethod: 'auto_detect',
    });
  });

  it('leaves rows without a matching outcome untouched (identity preserved)', () => {
    const rows = [makeRow('prod_1'), makeRow('prod_2')];
    const next = mergeResolveOutcomes(rows, [outcome('prod_2', { blockers: ['no-ean'] })]);
    expect(next[0]).toBe(rows[0]);
    expect(next[1]).toMatchObject({ productId: 'prod_2', blockers: ['no-ean'] });
  });
});

describe('selectBulkProductCardId (#808)', () => {
  function rowWith(partial: Partial<BulkWizardRow>): BulkWizardRow {
    return { ...makeRow('prod_1'), ...partial };
  }

  it('threads the resolved card on a clean auto-resolved row', () => {
    const row = rowWith({ resolvedCategoryId: '257933', resolvedProductCardId: 'card-1' });
    expect(selectBulkProductCardId(row)).toBe('card-1');
  });

  it('threads the resolved card when the seeded/edited override repeats the resolved category', () => {
    // Regression for the original bug: the review-step edit form seeds
    // override.overrides.categoryId with the resolved category even for
    // un-touched rows; the card must still be threaded.
    const row = rowWith({
      resolvedCategoryId: '257933',
      resolvedProductCardId: 'card-1',
      override: { overrides: { categoryId: '257933', title: 'Seeded title' } },
    });
    expect(selectBulkProductCardId(row)).toBe('card-1');
  });

  it('drops the card when the operator switched to a different category', () => {
    const row = rowWith({
      resolvedCategoryId: '257933',
      resolvedProductCardId: 'card-1',
      override: { overrides: { categoryId: '999000' } },
    });
    expect(selectBulkProductCardId(row)).toBeUndefined();
  });

  it('prefers an explicit operator-set card override', () => {
    const row = rowWith({
      resolvedCategoryId: '257933',
      resolvedProductCardId: 'card-1',
      override: { overrides: { productCardId: 'manual-card' } },
    });
    expect(selectBulkProductCardId(row)).toBe('manual-card');
  });

  it('returns undefined when there is no resolved card', () => {
    const row = rowWith({ resolvedCategoryId: '257933', resolvedProductCardId: null });
    expect(selectBulkProductCardId(row)).toBeUndefined();
  });
});

describe('recomputeRowBlockers (#810)', () => {
  const config: BulkWizardConfig = {
    connectionId: 'conn_1',
    deliveryPolicyId: 'dp_1',
    currency: 'PLN',
    pricingPolicy: { mode: 'flat', amount: 50 },
    stockPolicy: { mode: 'flat', value: 3 },
    publishImmediately: true,
    generateDescription: false,
  };

  const variant: ProductVariant = {
    id: 'var_1',
    productId: 'prod_1',
    sku: 'SKU',
    attributes: null,
    ean: '590',
    gtin: null,
    price: 50,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  function variantRow(partial: Partial<BulkWizardRow>): BulkWizardRow {
    return { ...makeRow('prod_1'), primaryVariant: variant, ...partial };
  }

  it('raises needs-product-parameters for a manually-categorised no-card row', () => {
    const row = variantRow({
      resolvedProductCardId: null,
      override: { overrides: { categoryId: 'cat-X' } },
    });
    const blockers = recomputeRowBlockers(row, config, new Map([['cat-X', ['brand', 'model']]]));
    expect(blockers).toContain('needs-product-parameters');
  });

  it('does not raise it once the required params are supplied', () => {
    const row = variantRow({
      resolvedProductCardId: null,
      override: {
        overrides: {
          categoryId: 'cat-X',
          parameters: [
            { id: 'brand', valuesIds: ['1'], section: 'product' },
            { id: 'model', values: ['Z'], section: 'product' },
          ],
        },
      },
    });
    const blockers = recomputeRowBlockers(row, config, new Map([['cat-X', ['brand', 'model']]]));
    expect(blockers).not.toContain('needs-product-parameters');
  });

  it('exempts a card-linked row (params inherited, #808)', () => {
    const row = variantRow({
      resolvedCategoryId: 'cat-X',
      resolvedProductCardId: 'card-1',
      override: { overrides: { categoryId: 'cat-X' } },
    });
    const blockers = recomputeRowBlockers(row, config, new Map([['cat-X', ['brand']]]));
    expect(blockers).not.toContain('needs-product-parameters');
  });

  it('stays inert until the category schema is known (no map entry)', () => {
    const row = variantRow({
      resolvedProductCardId: null,
      override: { overrides: { categoryId: 'cat-X' } },
    });
    const blockers = recomputeRowBlockers(row, config, new Map());
    expect(blockers).not.toContain('needs-product-parameters');
  });

  it('drops the stale card and blocks when a matched row is recategorised to a card-less category', () => {
    // Regression: editing an auto-matched row to a *different* category must
    // drop the card (it belonged to the resolved category), so the row is no
    // longer card-linked and the new category's required params apply.
    const row = variantRow({
      resolvedCategoryId: 'cat-A',
      resolvedProductCardId: 'card-1',
      override: { overrides: { categoryId: 'cat-B' } },
    });
    const blockers = recomputeRowBlockers(row, config, new Map([['cat-B', ['brand']]]));
    expect(blockers).toContain('needs-product-parameters');
  });
});
