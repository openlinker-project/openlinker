/**
 * Order Search Text Unit Tests (#3527, #3507 G03-14)
 *
 * Pins the normalizer, the corpus, and the PII gate: with `storePii: false`
 * only the order number and line SKUs are indexed, whatever the snapshot
 * still carries from a time when PII storage was on.
 *
 * @module libs/core/src/orders/domain
 */
import {
  buildOrderSearchCorpus,
  deriveOrderSearchText,
  normalizeOrderSearchText,
} from './order-search-text';

const WITH_PII = { storePii: true } as const;
const WITHOUT_PII = { storePii: false } as const;

const FULL_SNAPSHOT: Record<string, unknown> = {
  orderNumber: 'OL-4471',
  customerEmail: 'anna@example.test',
  billingAddress: { firstName: 'Anna', lastName: 'Nowak' },
  shippingAddress: { firstName: 'Jan', lastName: 'Kowalski' },
  items: [{ sku: 'MUG-WHT-350' }, { sku: 'CUP-BLK-200' }],
};

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
  it('should include order number, buyer email, names, and line SKUs when PII is stored', () => {
    const corpus = buildOrderSearchCorpus(FULL_SNAPSHOT, WITH_PII);

    expect(corpus).toContain('OL-4471');
    expect(corpus).toContain('anna@example.test');
    expect(corpus).toContain('Anna');
    expect(corpus).toContain('Nowak');
    expect(corpus).toContain('Jan');
    expect(corpus).toContain('Kowalski');
    expect(corpus).toContain('MUG-WHT-350');
    expect(corpus).toContain('CUP-BLK-200');
  });

  it('should index only the order number and SKUs when PII is not stored, even over an unredacted snapshot', () => {
    // The snapshot still carries real names and an email — exactly what a row
    // ingested before `OL_STORE_PII` was turned off looks like.
    const corpus = buildOrderSearchCorpus(FULL_SNAPSHOT, WITHOUT_PII);

    expect(corpus).toBe('OL-4471 MUG-WHT-350 CUP-BLK-200');
  });

  it('should skip fields that are absent, malformed, or empty', () => {
    const corpus = buildOrderSearchCorpus(
      {
        orderNumber: '',
        billingAddress: null,
        shippingAddress: 'not-an-object',
        items: 'not-an-array',
      },
      WITH_PII
    );

    expect(corpus).toBe('');
  });

  it('should skip a line item with no sku while keeping siblings that have one', () => {
    const corpus = buildOrderSearchCorpus(
      { items: [{ sku: 'A-1' }, { name: 'no sku here' }, { sku: 'B-2' }] },
      WITH_PII
    );

    expect(corpus).toBe('A-1 B-2');
  });
});

describe('deriveOrderSearchText', () => {
  it('should be the normalized corpus, matching a diacritic-folded query', () => {
    const searchText = deriveOrderSearchText(
      { orderNumber: 'OL-4471', billingAddress: { firstName: 'Anna', lastName: 'Nowąk' } },
      WITH_PII
    );

    // A query typed WITHOUT diacritics on a keyboard that lacks them must
    // still match a name that carries them — the whole point of folding both
    // sides through the same function.
    expect(searchText).toContain('nowak');
    expect(normalizeOrderSearchText('nowak')).toBe('nowak');
  });

  it('should contain neither the email nor any name when PII is not stored', () => {
    const searchText = deriveOrderSearchText(FULL_SNAPSHOT, WITHOUT_PII);

    expect(searchText).toBe('ol-4471 mug-wht-350 cup-blk-200');
    expect(searchText).not.toContain('@');
    expect(searchText).not.toContain('nowak');
    expect(searchText).not.toContain('kowalski');
  });

  it('should derive an empty string for a snapshot with no matchable text', () => {
    expect(deriveOrderSearchText({}, WITH_PII)).toBe('');
    expect(deriveOrderSearchText({}, WITHOUT_PII)).toBe('');
  });
});
