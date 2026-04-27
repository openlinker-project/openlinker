/**
 * Listings Query-Keys — unit tests
 *
 * Pins the queryKey shape contracts. The `categoryParameters` key embeds
 * the `CATEGORY_PARAMETERS_SCHEMA_VERSION` cache-bust constant at index 2
 * (#423) — this test guards against accidental queryKey shape changes that
 * would re-introduce the cache-staleness bug.
 *
 * @module apps/web/src/features/listings/api
 */
import { describe, expect, it } from 'vitest';
import { listingsQueryKeys } from './listings.query-keys';
import { CATEGORY_PARAMETERS_SCHEMA_VERSION } from './listings.types';

describe('listingsQueryKeys', () => {
  describe('categoryParameters', () => {
    it('embeds CATEGORY_PARAMETERS_SCHEMA_VERSION at index 2 (cache-bust contract, #423)', () => {
      expect(listingsQueryKeys.categoryParameters('c1', 'cat1')).toEqual([
        'listings',
        'categoryParameters',
        CATEGORY_PARAMETERS_SCHEMA_VERSION,
        'c1',
        'cat1',
      ]);
    });

    it('keys with different connectionId or categoryId are distinct', () => {
      const a = listingsQueryKeys.categoryParameters('c1', 'cat1');
      const b = listingsQueryKeys.categoryParameters('c1', 'cat2');
      const c = listingsQueryKeys.categoryParameters('c2', 'cat1');

      expect(a).not.toEqual(b);
      expect(a).not.toEqual(c);
      expect(b).not.toEqual(c);
    });
  });

  describe('cache-bust version', () => {
    it('CATEGORY_PARAMETERS_SCHEMA_VERSION is a positive integer', () => {
      expect(Number.isInteger(CATEGORY_PARAMETERS_SCHEMA_VERSION)).toBe(true);
      expect(CATEGORY_PARAMETERS_SCHEMA_VERSION).toBeGreaterThan(0);
    });
  });
});
