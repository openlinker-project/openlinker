/**
 * BulkWizard pure-reducer tests
 *
 * Pins the #796 widened guard: a `pending-after-timeout` outcome must not
 * overwrite a row already in a terminal state. The resolve-step fix
 * prevents the stale-closure `onComplete` from firing, so this is defence
 * in depth — but the reducer is the actual safety net, and a future
 * regression in the resolve step shouldn't be able to flip settled rows.
 */
import { describe, expect, it } from 'vitest';
import { applyResolveOutcomes } from './bulk-wizard';
import type { BulkResolveOutcome } from './bulk-resolve-step';
import type { BulkRowStatus, BulkWizardRow } from './bulk-wizard.types';

function makeRow(productId: string, status: BulkRowStatus): BulkWizardRow {
  return {
    productId,
    product: null,
    primaryVariant: null,
    status,
    resolvedCategoryId: null,
    resolutionMethod: null,
    override: {},
  };
}

function timedOut(productId: string): BulkResolveOutcome {
  return {
    productId,
    status: 'pending-after-timeout',
    categoryId: null,
    method: null,
  };
}

describe('applyResolveOutcomes', () => {
  it.each<BulkRowStatus>(['matched', 'no-match', 'no-ean', 'no-variant'])(
    'should ignore a pending-after-timeout outcome for a row already in terminal state "%s"',
    (terminalStatus) => {
      const rows = [{ ...makeRow('prod_1', terminalStatus), resolvedCategoryId: 'cat-A' }];
      const next = applyResolveOutcomes(rows, [timedOut('prod_1')]);
      expect(next[0]).toEqual(rows[0]);
    },
  );

  it('should apply a pending-after-timeout outcome when the row is still resolving', () => {
    const rows = [makeRow('prod_1', 'resolving')];
    const next = applyResolveOutcomes(rows, [timedOut('prod_1')]);
    expect(next[0]).toMatchObject({
      productId: 'prod_1',
      status: 'pending-after-timeout',
    });
  });

  it('should apply a settled outcome regardless of prior status (status flows forward in the happy path)', () => {
    const rows = [makeRow('prod_1', 'resolving')];
    const next = applyResolveOutcomes(rows, [
      {
        productId: 'prod_1',
        status: 'matched',
        categoryId: 'cat-A',
        method: 'auto_detect',
      },
    ]);
    expect(next[0]).toMatchObject({
      productId: 'prod_1',
      status: 'matched',
      resolvedCategoryId: 'cat-A',
      resolutionMethod: 'auto_detect',
    });
  });

  it('should leave rows without a matching outcome untouched', () => {
    const rows = [makeRow('prod_1', 'matched'), makeRow('prod_2', 'resolving')];
    const next = applyResolveOutcomes(rows, [timedOut('prod_2')]);
    expect(next[0]).toBe(rows[0]);
    expect(next[1]).toMatchObject({ status: 'pending-after-timeout' });
  });
});
