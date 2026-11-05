/**
 * bulk-blockers tests (#3851)
 *
 * Pins `categoryNotSetApplies`: the editor's `category not set` chip needs a
 * category cause from the resolve AND no category in the editor right now.
 */
import { describe, expect, it } from 'vitest';
import { blockerLabel, categoryNotSetApplies, chipFor, resolveBlockerChips } from './bulk-blockers';

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

describe('resolveBlockerChips', () => {
  const describeFn = (): { title: string; detail: string } => ({ title: 't', detail: 'd' });

  it('should keep a platform descriptor field and describe when merging', () => {
    const chips = resolveBlockerChips([
      { id: 'acme:x', tone: 'error', label: 'x label', field: 'title', describe: describeFn },
    ]);
    expect(chips['acme:x']).toMatchObject({ label: 'x label', field: 'title', fixable: true });
    expect(chips['acme:x'].describe).toBe(describeFn);
    expect(chips['no-ean']?.label).toBe('no barcode');
  });

  it('should carry the raw id when no descriptor knows the blocker', () => {
    expect(chipFor('acme:gone', resolveBlockerChips([])).label).toBe('needs attention: acme:gone');
    expect(blockerLabel('acme:gone')).toBe('needs attention: acme:gone');
  });
});
