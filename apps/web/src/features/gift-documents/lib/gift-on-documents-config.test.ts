/**
 * Gift on documents config tests (#3941)
 *
 * @module apps/web/src/features/gift-documents/lib
 */
import { describe, expect, it } from 'vitest';
import { mergeGiftOnDocumentsConfig, readGiftConnectionOverride } from './gift-on-documents-config';

describe('readGiftConnectionOverride', () => {
  it('should read null when the connection inherits', () => {
    expect(readGiftConnectionOverride(undefined)).toBeNull();
    expect(readGiftConnectionOverride({})).toBeNull();
    expect(readGiftConnectionOverride({ giftOnDocuments: {} })).toBeNull();
    expect(readGiftConnectionOverride({ giftOnDocuments: { form: 'nonsense' } })).toBeNull();
  });

  it('should read a form, treat the earlier show as show-zero and ignore differentRateGift', () => {
    expect(readGiftConnectionOverride({ giftOnDocuments: { form: 'priced-in' } })).toBe('priced-in');
    expect(readGiftConnectionOverride({ giftOnDocuments: { form: 'show' } })).toBe('show-zero');
    expect(
      readGiftConnectionOverride({ giftOnDocuments: { form: 'omit', differentRateGift: 'priced-in' } }),
    ).toBe('omit');
  });
});

describe('mergeGiftOnDocumentsConfig', () => {
  it('should keep every other key and drop the legacy field when it writes the override', () => {
    expect(
      mergeGiftOnDocumentsConfig(
        { rateLimit: { maxConcurrent: 2 }, giftOnDocuments: { form: 'omit', differentRateGift: 'x' } },
        'priced-in',
      ),
    ).toEqual({ rateLimit: { maxConcurrent: 2 }, giftOnDocuments: { form: 'priced-in' } });
  });

  it('should remove the key when the connection goes back to inheriting', () => {
    expect(mergeGiftOnDocumentsConfig({ a: 1, giftOnDocuments: { form: 'omit' } }, null)).toEqual({ a: 1 });
  });
});
