import { foldPolish, toSearchTerms, foldSqlExpr } from './product-search';

describe('product-search', () => {
  it('should fold Polish diacritics when building terms', () => {
    expect(foldPolish('Żarówka łódź')).toBe('Zarowka lodz');
  });

  it('should split terms on whitespace and drop empties', () => {
    expect(toSearchTerms('  lampa   biała ')).toEqual(['lampa', 'biala']);
    expect(toSearchTerms('   ')).toEqual([]);
  });

  it('should escape LIKE wildcards and backslashes', () => {
    expect(toSearchTerms('50%_a\\')).toEqual(['50\\%\\_a\\\\']);
  });

  it('should fold the column side with translate', () => {
    expect(foldSqlExpr('product.name')).toContain("translate(COALESCE(product.name, ''), ");
  });
});
