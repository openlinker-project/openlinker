/**
 * Destination Category Search Normalization — unit tests (#1979)
 *
 * This helper is the one thing the write path (the stored `searchText`) and the
 * read path (the incoming query) must agree about, so it is tested directly
 * rather than only through the repository.
 */
import { normalizeCategorySearchText } from '../destination-category-search';

describe('normalizeCategorySearchText', () => {
  it('should strip Polish diacritics so an ASCII query matches an accented name', () => {
    expect(normalizeCategorySearchText('Odzież')).toBe('odziez');
    expect(normalizeCategorySearchText('Kość')).toBe('kosc');
    expect(normalizeCategorySearchText('Żółć')).toBe('zolc');
  });

  it('should fold letters NFD cannot decompose, notably the Polish stroked l', () => {
    // `ł` is a distinct letter (U+0142), not a base + combining mark, so NFD
    // leaves it intact. Without an explicit fold, `artykuly` matches nothing.
    expect(normalizeCategorySearchText('Artykuły')).toBe('artykuly');
    expect(normalizeCategorySearchText('Łóżko')).toBe('lozko');
  });

  it('should lowercase so search is case-insensitive', () => {
    expect(normalizeCategorySearchText('BUTY')).toBe('buty');
  });

  it('should collapse and trim whitespace so spacing differences do not matter', () => {
    expect(normalizeCategorySearchText('  Buty   sportowe  ')).toBe('buty sportowe');
  });

  it('should produce an identical result for a name and an equivalent query', () => {
    // The invariant that makes the stored column and the query comparable.
    expect(normalizeCategorySearchText('Odzież Damska')).toBe(
      normalizeCategorySearchText('  odziez   DAMSKA '),
    );
  });

  it('should return an empty string when the input is only whitespace', () => {
    expect(normalizeCategorySearchText('   ')).toBe('');
  });

  it('should leave a name with no diacritics or padding unchanged', () => {
    expect(normalizeCategorySearchText('shoes')).toBe('shoes');
  });
});
