/**
 * Auto-Prefill Parameters — unit tests
 *
 * @module apps/web/src/features/listings/components
 */
import { describe, expect, it } from 'vitest';
import type { CatalogProduct, CategoryParameter } from '../api/listings.types';
import { autoPrefillParameters, prefillFromCatalogProduct } from './auto-prefill-parameters';

function param(overrides: Partial<CategoryParameter>): CategoryParameter {
  return {
    id: 'x',
    name: 'X',
    type: 'string',
    required: false,
    restrictions: {},
    section: 'offer',
    ...overrides,
  };
}

describe('autoPrefillParameters', () => {
  it('fills EAN parameter from variant.ean', () => {
    const out = autoPrefillParameters(
      [param({ id: 'p1', name: 'EAN (GTIN)', type: 'string' })],
      { ean: '5901234123457' },
    );
    expect(out.p1).toBe('5901234123457');
  });

  it('matches multiple EAN-class names case-insensitively', () => {
    const out = autoPrefillParameters(
      [
        param({ id: 'p1', name: 'GTIN', type: 'string' }),
        param({ id: 'p2', name: 'kod ean', type: 'string' }),
      ],
      { ean: '111' },
    );
    expect(out.p1).toBe('111');
    expect(out.p2).toBe('111');
  });

  it('does not fill EAN when variant.ean is empty', () => {
    const out = autoPrefillParameters([param({ id: 'p1', name: 'EAN' })], { ean: undefined });
    expect(out.p1).toBeUndefined();
  });

  it('defaults Stan to "Nowy" entry id when present in dictionary', () => {
    const out = autoPrefillParameters(
      [
        param({
          id: 'p1',
          name: 'Stan',
          type: 'dictionary',
          dictionary: [
            { id: 'p1_new', value: 'Nowy' },
            { id: 'p1_used', value: 'Używany' },
          ],
        }),
      ],
      {},
    );
    expect(out.p1).toBe('p1_new');
  });

  it('skips Stan default when no "new"-like entry exists', () => {
    const out = autoPrefillParameters(
      [
        param({
          id: 'p1',
          name: 'Stan',
          type: 'dictionary',
          dictionary: [{ id: 'p1_used', value: 'Używany' }],
        }),
      ],
      {},
    );
    expect(out.p1).toBeUndefined();
  });

  it('skips brand and producer-code (deferred to #412)', () => {
    const out = autoPrefillParameters(
      [
        param({ id: 'p1', name: 'Marka', type: 'dictionary' }),
        param({ id: 'p2', name: 'Kod producenta', type: 'string' }),
      ],
      { ean: '999' },
    );
    expect(out.p1).toBeUndefined();
    expect(out.p2).toBeUndefined();
  });
});

function catalogProduct(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: 'cat-1',
    name: 'Catalog product',
    parameters: [],
    ...overrides,
  };
}

describe('prefillFromCatalogProduct', () => {
  it('writes dictionary single-choice from valueIds[0]', () => {
    const params = [
      param({
        id: 'p1',
        name: 'Marka',
        type: 'dictionary',
        dictionary: [
          { id: 'b_acme', value: 'ACME' },
          { id: 'b_other', value: 'Other' },
        ],
      }),
    ];
    const cp = catalogProduct({
      parameters: [{ parameterId: 'p1', name: 'Marka', valueIds: ['b_acme'] }],
    });

    const { values, prefilledIds } = prefillFromCatalogProduct(params, cp, {});

    expect(values.p1).toBe('b_acme');
    expect(prefilledIds.has('p1')).toBe(true);
  });

  it('writes dictionary multi-choice as full valueIds array', () => {
    const params = [
      param({
        id: 'p1',
        name: 'Kolory',
        type: 'dictionary',
        restrictions: { multipleChoices: true },
        dictionary: [
          { id: 'c_red', value: 'Red' },
          { id: 'c_blue', value: 'Blue' },
        ],
      }),
    ];
    const cp = catalogProduct({
      parameters: [{ parameterId: 'p1', name: 'Kolory', valueIds: ['c_red', 'c_blue'] }],
    });

    const { values } = prefillFromCatalogProduct(params, cp, {});

    expect(values.p1).toEqual(['c_red', 'c_blue']);
  });

  it('writes string/numeric from valueStrings[0]', () => {
    const params = [
      param({ id: 'p1', name: 'Kod producenta', type: 'string' }),
      param({ id: 'p2', name: 'Masa', type: 'float' }),
    ];
    const cp = catalogProduct({
      parameters: [
        { parameterId: 'p1', name: 'Kod producenta', valueStrings: ['SKU-1'] },
        { parameterId: 'p2', name: 'Masa', valueStrings: ['1.5'] },
      ],
    });

    const { values, prefilledIds } = prefillFromCatalogProduct(params, cp, {});

    expect(values.p1).toBe('SKU-1');
    expect(values.p2).toBe('1.5');
    expect(prefilledIds.size).toBe(2);
  });

  it('skips parameters present in dirtyFields', () => {
    const params = [
      param({ id: 'p1', name: 'Marka', type: 'dictionary', dictionary: [{ id: 'b1', value: 'ACME' }] }),
      param({ id: 'p2', name: 'Kod', type: 'string' }),
    ];
    const cp = catalogProduct({
      parameters: [
        { parameterId: 'p1', name: 'Marka', valueIds: ['b1'] },
        { parameterId: 'p2', name: 'Kod', valueStrings: ['X'] },
      ],
    });

    const { values, prefilledIds } = prefillFromCatalogProduct(params, cp, { p1: true });

    expect(values.p1).toBeUndefined();
    expect(values.p2).toBe('X');
    expect(prefilledIds.has('p1')).toBe(false);
    expect(prefilledIds.has('p2')).toBe(true);
  });

  it('drops catalog parameters whose parameterId is not in the rendered list', () => {
    const params = [param({ id: 'p1', name: 'Marka', type: 'dictionary' })];
    const cp = catalogProduct({
      parameters: [{ parameterId: 'p_missing', name: 'Other', valueStrings: ['x'] }],
    });

    const { values, prefilledIds } = prefillFromCatalogProduct(params, cp, {});

    expect(values).toEqual({});
    expect(prefilledIds.size).toBe(0);
  });

  it('skips range-typed parameters', () => {
    const params = [
      param({
        id: 'p1',
        name: 'Wiek',
        type: 'integer',
        restrictions: { range: true },
      }),
    ];
    const cp = catalogProduct({
      parameters: [{ parameterId: 'p1', name: 'Wiek', valueStrings: ['18'] }],
    });

    const { values, prefilledIds } = prefillFromCatalogProduct(params, cp, {});

    expect(values.p1).toBeUndefined();
    expect(prefilledIds.size).toBe(0);
  });

  it('skips dictionary entries with empty valueIds', () => {
    const params = [
      param({ id: 'p1', name: 'Marka', type: 'dictionary', dictionary: [{ id: 'b1', value: 'ACME' }] }),
    ];
    const cp = catalogProduct({
      parameters: [{ parameterId: 'p1', name: 'Marka', valueIds: [] }],
    });

    const { values, prefilledIds } = prefillFromCatalogProduct(params, cp, {});

    expect(values.p1).toBeUndefined();
    expect(prefilledIds.size).toBe(0);
  });
});
