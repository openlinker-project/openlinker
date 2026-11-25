/**
 * Catalogue mode helper tests (#4280)
 *
 * @module libs/core/src/identifier-mapping/domain/types/__tests__
 */
import {
  CATALOGUE_MODE_CONFIG_KEY,
  DEFAULT_CATALOGUE_MODE,
  isPresentButInvalidCatalogueMode,
  readCatalogueMode,
} from '../catalogue-mode.types';

describe('catalogue-mode', () => {
  describe('readCatalogueMode', () => {
    it('should default to linked when config is null or undefined', () => {
      expect(readCatalogueMode(null)).toBe('linked');
      expect(readCatalogueMode(undefined)).toBe('linked');
    });

    it('should default to linked when the key is absent (existing installs are unchanged)', () => {
      expect(readCatalogueMode({})).toBe('linked');
      expect(readCatalogueMode({ masterCatalogConnectionId: 'c1' })).toBe('linked');
    });

    it('should read an explicit null as linked (the form clears a knob with null, not by deleting it)', () => {
      expect(readCatalogueMode({ [CATALOGUE_MODE_CONFIG_KEY]: null })).toBe('linked');
    });

    it('should read none and linked verbatim', () => {
      expect(readCatalogueMode({ catalogueMode: 'none' })).toBe('none');
      expect(readCatalogueMode({ catalogueMode: 'linked' })).toBe('linked');
    });

    it('should fail safe to linked for an unrecognised value rather than guessing none', () => {
      expect(readCatalogueMode({ catalogueMode: 'None' })).toBe('linked');
      expect(readCatalogueMode({ catalogueMode: '' })).toBe('linked');
      expect(readCatalogueMode({ catalogueMode: 1 as unknown as string })).toBe('linked');
      expect(readCatalogueMode({ catalogueMode: true as unknown as string })).toBe('linked');
    });

    it('should expose linked as the default mode constant', () => {
      expect(DEFAULT_CATALOGUE_MODE).toBe('linked');
    });
  });

  describe('isPresentButInvalidCatalogueMode', () => {
    it('should not flag an absent key, a null value or a recognised value', () => {
      expect(isPresentButInvalidCatalogueMode(undefined)).toBe(false);
      expect(isPresentButInvalidCatalogueMode({})).toBe(false);
      expect(isPresentButInvalidCatalogueMode({ catalogueMode: null })).toBe(false);
      expect(isPresentButInvalidCatalogueMode({ catalogueMode: 'none' })).toBe(false);
      expect(isPresentButInvalidCatalogueMode({ catalogueMode: 'linked' })).toBe(false);
    });

    it('should flag a present value that reads back as the default for the wrong reason', () => {
      expect(isPresentButInvalidCatalogueMode({ catalogueMode: 'None' })).toBe(true);
      expect(isPresentButInvalidCatalogueMode({ catalogueMode: 'off' })).toBe(true);
      expect(isPresentButInvalidCatalogueMode({ catalogueMode: true as unknown as string })).toBe(
        true
      );
    });
  });
});
