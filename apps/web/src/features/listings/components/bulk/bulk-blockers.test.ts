/**
 * bulk-blockers tests (#3851)
 *
 * Pins `categoryNotSetApplies`: the editor's `category not set` chip needs a
 * category cause from the resolve AND no category in the editor right now.
 *
 * Also pins the `stock-unknown` sentence from `describeBlocker`: the remedy
 * differs by product shape, because a multi-variant sibling always lists at its
 * master stock and a hand-set stock does not reach it.
 */
import { describe, expect, it } from 'vitest';
import type { OfferBlockerCopy } from '../../../../shared/plugins';
import {
  blockerLabel,
  categoryNotSetApplies,
  chipFor,
  describeBlocker,
  resolveBlockerChips,
  type BlockerCopyContext,
} from './bulk-blockers';

describe('categoryNotSetApplies', () => {
  it('should apply when a category cause is present and no category is set', () => {
    expect(categoryNotSetApplies(['no-match'], null)).toBe(true);
    expect(categoryNotSetApplies(['multi-match'], '')).toBe(true);
  });

  it('should not apply once the editor carries a category', () => {
    expect(categoryNotSetApplies(['no-match'], 'cat_1')).toBe(false);
  });

  it('should treat a blank category as not set', () => {
    expect(categoryNotSetApplies(['no-ean'], '   ')).toBe(true);
  });

  it('should not apply to an invalid barcode, which survives a set category', () => {
    expect(categoryNotSetApplies(['invalid-barcode'], null)).toBe(false);
  });

  it('should not apply without a category cause', () => {
    expect(categoryNotSetApplies(['no-master-price'], null)).toBe(false);
    expect(categoryNotSetApplies([], null)).toBe(false);
  });
});

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

describe('blockerLabel', () => {
  it('should render every chip label in sentence case', () => {
    expect(blockerLabel('no-ean')).toBe('No barcode');
    expect(blockerLabel('no-tax-rate')).toBe('No tax rate');
    expect(blockerLabel('some-plugin:unknown')).toBe('Needs attention: some-plugin:unknown');
  });
});

describe('resolveBlockerChips', () => {
  const describeFn = (): { title: string; detail: string } => ({ title: 't', detail: 'd' });

  it('should keep a platform descriptor field and describe when merging', () => {
    const chips = resolveBlockerChips([
      { id: 'acme:x', tone: 'error', label: 'x label', field: 'title', describe: describeFn },
    ]);
    expect(chips['acme:x']).toMatchObject({ label: 'x label', field: 'title', fixable: true });
    expect(chips['acme:x'].describe).toBe(describeFn);
    expect(chips['no-ean']?.label).toBe('No barcode');
  });

  it('should carry the raw id when no descriptor knows the blocker', () => {
    expect(chipFor('acme:gone', resolveBlockerChips([])).label).toBe('Needs attention: acme:gone');
    expect(blockerLabel('acme:gone')).toBe('Needs attention: acme:gone');
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
        describe: (ctx): OfferBlockerCopy => ({ title: 'T', detail: 'D', items: ctx.missingParameterNames ?? [] }),
      },
    ]);
    expect(describeBlocker('acme:x', { ...base, chips, missingParameterNames: ['Model'] })).toEqual({
      title: 'T',
      detail: 'D',
      items: ['Model'],
    });
  });

  it('should name the chip label in the generic sentence when there is no descriptor sentence', () => {
    const chips = resolveBlockerChips([{ id: 'acme:y', tone: 'error', label: 'y label' }]);
    expect(describeBlocker('acme:y', { ...base, chips }).title).toBe('y label.');
  });
});
