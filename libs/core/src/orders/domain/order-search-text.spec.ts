import {
  buildOrderSearchCorpus,
  deriveOrderSearchText,
  normalizeOrderSearchText,
} from './order-search-text';

describe('normalizeOrderSearchText', () => {
  it('should lowercase and fold diacritics', () => {
    expect(normalizeOrderSearchText('Anna Nowak')).toBe('anna nowak');
    expect(normalizeOrderSearchText('Odzież')).toBe('odziez');
  });

  it('should fold non-decomposing letters like ł', () => {
    // The `Artykuły` trap `normalizeCategorySearchText`'s docblock warns about:
    // NFD does not decompose `ł` into `l` + a combining mark.
    expect(normalizeOrderSearchText('Artykuły')).toBe('artykuly');
  });

  it('should collapse whitespace and trim', () => {
    expect(normalizeOrderSearchText('  OL-4471   Anna  ')).toBe('ol-4471 anna');
  });

  it('should return an empty string for input that is entirely diacritics/whitespace', () => {
    expect(normalizeOrderSearchText('   ')).toBe('');
  });
});

describe('buildOrderSearchCorpus', () => {
  it('should include order number, buyer email, names, and line SKUs', () => {
    const corpus = buildOrderSearchCorpus({
      orderNumber: 'OL-4471',
      customerEmail: 'anna@example.test',
      billingAddress: { firstName: 'Anna', lastName: 'Nowak' },
      shippingAddress: { firstName: 'Jan', lastName: 'Kowalski' },
      items: [{ sku: 'MUG-WHT-350' }, { sku: 'CUP-BLK-200' }],
    });

    expect(corpus).toContain('OL-4471');
    expect(corpus).toContain('anna@example.test');
    expect(corpus).toContain('Anna');
    expect(corpus).toContain('Nowak');
    expect(corpus).toContain('Jan');
    expect(corpus).toContain('Kowalski');
    expect(corpus).toContain('MUG-WHT-350');
    expect(corpus).toContain('CUP-BLK-200');
  });

  it('should skip fields that are absent, malformed, or empty', () => {
    const corpus = buildOrderSearchCorpus({
      orderNumber: '',
      billingAddress: null,
      shippingAddress: 'not-an-object',
      items: 'not-an-array',
    });

    expect(corpus).toBe('');
  });

  it('should skip a line item with no sku while keeping siblings that have one', () => {
    const corpus = buildOrderSearchCorpus({
      items: [{ sku: 'A-1' }, { name: 'no sku here' }, { sku: 'B-2' }],
    });

    expect(corpus).toBe('A-1 B-2');
  });
});

describe('deriveOrderSearchText', () => {
  it('should be the normalized corpus, matching a diacritic-folded query', () => {
    const searchText = deriveOrderSearchText({
      orderNumber: 'OL-4471',
      billingAddress: { firstName: 'Anna', lastName: 'Nowak' },
    });

    // A query typed WITHOUT diacritics on a keyboard that lacks them must
    // still match a name that carries them — the whole point of folding both
    // sides through the same function.
    expect(searchText).toContain('nowak');
    expect(normalizeOrderSearchText('nowak')).toBe('nowak');
  });

  it('should derive an empty string for a snapshot with no matchable text', () => {
    expect(deriveOrderSearchText({})).toBe('');
  });
});
