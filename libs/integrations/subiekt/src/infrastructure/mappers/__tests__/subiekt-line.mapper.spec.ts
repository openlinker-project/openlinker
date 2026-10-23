/**
 * Subiekt Line Mapper — unit tests
 *
 * Covers the catalogue-symbol resolution that decides whether a document line
 * becomes a real catalogue position (`SuPozycje.Dodaj(symbol)`, which moves
 * stock) or a one-time service line (`DodajUslugeJednorazowa`, which does not).
 *
 * @module libs/integrations/subiekt/src/infrastructure/mappers/__tests__
 */
import type { InvoiceLine } from '@openlinker/core/invoicing';
import { toBridgeLines } from '../subiekt-line.mapper';

function line(overrides: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    name: 'Kubek ceramiczny 300ml',
    quantity: 2,
    unitPriceGross: 24.99,
    taxRate: '23',
    ...overrides,
  };
}

describe('toBridgeLines', () => {
  it('emits a catalogue line when the product resolves to a Subiekt symbol', () => {
    const [mapped] = toBridgeLines(
      [line({ productId: 'ol_product_1' })],
      undefined,
      new Map([['ol_product_1', 'SUBIEKT-E2E-001']]),
    );
    expect(mapped).toMatchObject({
      towarSymbol: 'SUBIEKT-E2E-001',
      ilosc: 2,
      cenaBrutto: 24.99,
      stawkaVAT: '23',
    });
  });

  it('omits the symbol when the product has no mapping, so the line stays a service line', () => {
    const [mapped] = toBridgeLines([line({ productId: 'ol_product_unmapped' })], undefined, new Map());
    expect(mapped).not.toHaveProperty('towarSymbol');
  });

  it('omits the symbol for a line that carries no product at all (a shipping charge)', () => {
    const [mapped] = toBridgeLines(
      [line({ name: 'Dostawa', quantity: 1, unitPriceGross: 10.95 })],
      undefined,
      new Map([['ol_product_1', 'SUBIEKT-E2E-001']]),
    );
    expect(mapped).not.toHaveProperty('towarSymbol');
  });

  it('omits the symbol when no resolution map is supplied at all (pre-resolution callers)', () => {
    const [mapped] = toBridgeLines([line({ productId: 'ol_product_1' })]);
    expect(mapped).not.toHaveProperty('towarSymbol');
  });

  it('treats an empty resolved symbol as unresolved rather than sending a blank one', () => {
    const [mapped] = toBridgeLines(
      [line({ productId: 'ol_product_1' })],
      undefined,
      new Map([['ol_product_1', '']]),
    );
    expect(mapped).not.toHaveProperty('towarSymbol');
  });

  it('resolves each line independently in a multi-product order', () => {
    const mapped = toBridgeLines(
      [
        line({ name: 'Kubek', productId: 'ol_product_1' }),
        line({ name: 'Pomadka', productId: 'ol_product_2', unitPriceGross: 324 }),
        line({ name: 'Dostawa', quantity: 1, unitPriceGross: 10.95 }),
      ],
      undefined,
      new Map([
        ['ol_product_1', 'SUBIEKT-E2E-001'],
        ['ol_product_2', 'PESO20'],
      ]),
    );
    expect(mapped.map((m) => m.towarSymbol)).toEqual(['SUBIEKT-E2E-001', 'PESO20', undefined]);
  });
});
