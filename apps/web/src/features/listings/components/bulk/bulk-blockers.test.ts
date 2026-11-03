/**
 * bulk-blockers tests (#3851)
 *
 * Pins `categoryNotSetApplies`: the editor's `category not set` chip needs a
 * category cause from the resolve AND no category in the editor right now.
 */
import { describe, expect, it } from 'vitest';
import { categoryNotSetApplies } from './bulk-blockers';

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
