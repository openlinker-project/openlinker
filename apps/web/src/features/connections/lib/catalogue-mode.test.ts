/**
 * Catalogue mode (browser side) tests (#4281)
 *
 * The rule must read exactly like core's `readCatalogueMode`: only the literal
 * `'none'` turns the mode on; everything else is the historical `linked`.
 *
 * @module apps/web/src/features/connections/lib
 */
import { describe, expect, it } from 'vitest';
import { CatalogueModeValues, readCatalogueMode } from './catalogue-mode';

describe('readCatalogueMode', () => {
  it('should read linked when the key is absent, so an existing connection is unchanged', () => {
    expect(readCatalogueMode({})).toBe('linked');
    expect(readCatalogueMode(null)).toBe('linked');
    expect(readCatalogueMode(undefined)).toBe('linked');
  });

  it('should read an explicit null as linked, which is what the form writes for the default', () => {
    expect(readCatalogueMode({ catalogueMode: null })).toBe('linked');
  });

  it('should read none only for the exact literal', () => {
    expect(readCatalogueMode({ catalogueMode: 'none' })).toBe('none');
    expect(readCatalogueMode({ catalogueMode: 'None' })).toBe('linked');
    expect(readCatalogueMode({ catalogueMode: true })).toBe('linked');
  });

  it('should declare the same two literals as core', () => {
    expect(CatalogueModeValues).toEqual(['linked', 'none']);
  });
});
