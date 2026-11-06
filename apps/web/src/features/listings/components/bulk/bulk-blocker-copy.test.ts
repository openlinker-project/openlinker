/**
 * bulk-blocker-copy tests (#3851)
 *
 * Pins the `stock-unknown` sentence: the remedy differs by product shape,
 * because a multi-variant sibling always lists at its master stock and a
 * hand-set stock does not reach it.
 */
import { describe, expect, it } from 'vitest';
import { describeBlocker, type BlockerCopyContext } from './bulk-blocker-copy';
import type { OfferBlockerCopy } from '../../../../shared/plugins';
import { resolveBlockerChips } from './bulk-blockers';

const ctx = (variantCount: number): BlockerCopyContext => ({
  ean: null,
  destinationName: 'Allegro',
  variantCount,
  batchCurrency: 'PLN',
});

describe('describeBlocker stock-unknown', () => {
  it('should offer a hand-set stock for a simple product', () => {
    const copy = describeBlocker('stock-unknown', ctx(1));
    expect(copy.title).toBe('OpenLinker has no stock for this variant yet.');
    expect(copy.detail).toContain('set the stock by hand');
  });

  it('should offer switching the sibling off for a multi-variant product', () => {
    const copy = describeBlocker('stock-unknown', ctx(3));
    expect(copy.detail).toContain('switch this variant off');
    expect(copy.detail).not.toContain('by hand');
  });
});

describe('describeBlocker for a platform blocker (#4003)', () => {
  const base = { ean: null, destinationName: 'Acme', variantCount: 2, batchCurrency: 'PLN' };

  it('should use the descriptor sentence when the chip declares one', () => {
    const chips = resolveBlockerChips([
      {
        id: 'acme:x',
        tone: 'error',
        label: 'x',
        describe: (ctx): OfferBlockerCopy => ({ title: `T ${ctx.destinationName}`, detail: 'D', items: ctx.missingParameterNames ?? [] }),
      },
    ]);
    expect(describeBlocker('acme:x', { ...base, chips, missingParameterNames: ['Model'] })).toEqual({
      title: 'T Acme',
      detail: 'D',
      items: ['Model'],
    });
  });

  it('should name the chip label in the generic sentence when there is no descriptor sentence', () => {
    const chips = resolveBlockerChips([{ id: 'acme:y', tone: 'error', label: 'y label' }]);
    expect(describeBlocker('acme:y', { ...base, chips }).title).toBe('y label.');
  });
});
