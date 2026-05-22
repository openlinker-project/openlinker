/**
 * BulkWizard pure-reducer tests (#792 PR 3)
 *
 * Pins `mergeResolveOutcomes`: resolve outcomes are folded into rows by
 * productId; rows without a matching outcome keep their identity.
 */
import { describe, expect, it } from 'vitest';
import { mergeResolveOutcomes } from './bulk-wizard';
import type { BulkResolveOutcome } from './bulk-resolve-step';
import type { BulkWizardRow } from './bulk-wizard.types';

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
