/**
 * The pure rules the bundle form's steps share: what a price may look like, what a
 * composition cannot be, and which EAN is worth sending.
 */
import { describe, expect, it } from 'vitest';
import {
  clampSeedQuantity,
  compositionProblem,
  isValidEan,
  namedPackSize,
  packSizeMismatch,
  parsePrice,
  priceProblem,
  shortComponentName,
  type ParsedRow,
} from './bundle-form-model';

function row(over: Partial<ParsedRow>): ParsedRow {
  return {
    variantId: 'v',
    productId: 'p',
    name: 'Kubek',
    sku: 'K',
    price: 10,
    currency: 'PLN',
    availableToPromise: 5,
    isBundle: false,
    quantity: '1',
    gift: false,
    documentForm: '',
    qty: 1,
    ...over,
  };
}

describe('parsePrice / priceProblem', () => {
  it.each([
    ['49,90', 49.9],
    ['49.90', 49.9],
    ['1 299,00', 1299],
    ['1.299,00', 1299],
  ])('should read %s as %d', (text, value) => {
    expect(parsePrice(text)).toBe(value);
  });

  it('should say why a price is refused', () => {
    expect(priceProblem('')).toBe('empty');
    expect(priceProblem('-5')).toBe('invalid');
    expect(priceProblem('abc')).toBe('invalid');
    expect(priceProblem('0')).toBe('invalid');
    expect(priceProblem('1999999999')).toBe('high');
    expect(priceProblem('49,90')).toBeNull();
  });
});

describe('compositionProblem', () => {
  it('should refuse a bundle with no paid component', () => {
    expect(compositionProblem([row({ gift: true }), row({ variantId: 'w', gift: true })])).toBe('no-paid');
  });

  it('should refuse one product in a quantity of one, and accept it from two', () => {
    expect(compositionProblem([row({})])).toBe('single-piece');
    expect(compositionProblem([row({ qty: 2, quantity: '2' })])).toBeNull();
  });

  it('should accept a paid component beside a gift', () => {
    expect(compositionProblem([row({}), row({ variantId: 'w', gift: true })])).toBeNull();
  });
});

describe('isValidEan', () => {
  it('should accept an empty EAN and 8, 12, 13 or 14 digits only', () => {
    expect(isValidEan('')).toBe(true);
    expect(isValidEan('5901234123457')).toBe(true);
    expect(isValidEan('1234567')).toBe(false);
    expect(isValidEan('59012341234ab')).toBe(false);
  });
});

describe('seed helpers (round 5)', () => {
  it('should clamp seeded quantities into 1..9999 and flag what it changed', () => {
    expect(clampSeedQuantity(undefined)).toEqual({ quantity: 1, altered: false });
    expect(clampSeedQuantity('3')).toEqual({ quantity: 3, altered: false });
    expect(clampSeedQuantity('99999')).toEqual({ quantity: 9999, altered: true });
    expect(clampSeedQuantity('0')).toEqual({ quantity: 1, altered: true });
    expect(clampSeedQuantity('-3')).toEqual({ quantity: 1, altered: true });
    expect(clampSeedQuantity('1.5')).toEqual({ quantity: 1, altered: true });
    expect(clampSeedQuantity('abc')).toEqual({ quantity: 1, altered: true });
  });

  it('should shorten a component name to its first words', () => {
    expect(shortComponentName('OL Test Kubek ceramiczny muzyczny (karta Allegro)')).toBe('OL Test Kubek');
    expect(shortComponentName('Kubek')).toBe('Kubek');
    expect(shortComponentName('')).toBe('');
  });

  it('should read a pack size from a name', () => {
    expect(namedPackSize('Kubek x3')).toBe(3);
    expect(namedPackSize('Kubek ×6 (wielopak)')).toBe(6);
    expect(namedPackSize('Kubek 4 szt.')).toBe(4);
    expect(namedPackSize('Kubek x1')).toBeNull();
    expect(namedPackSize('Maxi kubek')).toBeNull();
  });

  it('should report a name that disagrees with the single component quantity', () => {
    const one = [row({ qty: 1, quantity: '1' })];
    expect(packSizeMismatch('Kubek x3', one)).toEqual({ named: 3, actual: 1 });
    expect(packSizeMismatch('Kubek x3', [row({ qty: 3, quantity: '3' })])).toBeNull();
    expect(packSizeMismatch('Kubek x3', [row({}), row({ variantId: 'w' })])).toBeNull();
    expect(packSizeMismatch(null, one)).toBeNull();
  });
});
