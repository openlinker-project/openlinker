/**
 * Auto-Prefill Parameters — unit tests
 *
 * @module apps/web/src/features/listings/components
 */
import { describe, expect, it } from 'vitest';
import type { CatalogProduct, CategoryParameter } from '../api/listings.types';
import {
  autoPrefillParameters,
  collectUnmatchedBrandHints,
  prefillFromCatalogProduct,
} from './auto-prefill-parameters';

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

  it('skips brand and producer-code when variant carries no brand / mpn (#412)', () => {
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

  // ===== Brand (Marka) — #412 =====================================

  it('fills brand from exact case-insensitive dictionary match', () => {
    const out = autoPrefillParameters(
      [
        param({
          id: 'p1',
          name: 'Marka',
          type: 'dictionary',
          dictionary: [
            { id: 'p1_sony', value: 'Sony' },
            { id: 'p1_samsung', value: 'Samsung' },
          ],
        }),
      ],
      { brand: 'sony' },
    );
    expect(out.p1).toBe('p1_sony');
  });

  it('leaves brand blank when no dictionary entry matches', () => {
    const out = autoPrefillParameters(
      [
        param({
          id: 'p1',
          name: 'Marka',
          type: 'dictionary',
          dictionary: [{ id: 'p1_x', value: 'OtherBrand' }],
        }),
      ],
      { brand: 'Sony' },
    );
    expect(out.p1).toBeUndefined();
  });

  it('leaves brand blank on ambiguous (multi-match) dictionary entries', () => {
    // Defensive — Allegro brand dictionaries normally have one entry per
    // brand. If two entries collide on case-insensitive value, we'd rather
    // leave the field blank than pick the wrong one.
    const out = autoPrefillParameters(
      [
        param({
          id: 'p1',
          name: 'Marka',
          type: 'dictionary',
          dictionary: [
            { id: 'p1_a', value: 'Sony' },
            { id: 'p1_b', value: 'sony' },
          ],
        }),
      ],
      { brand: 'Sony' },
    );
    expect(out.p1).toBeUndefined();
  });

  it('does not fill brand when variant has no brand value', () => {
    const out = autoPrefillParameters(
      [
        param({
          id: 'p1',
          name: 'Marka',
          type: 'dictionary',
          dictionary: [{ id: 'p1_sony', value: 'Sony' }],
        }),
      ],
      {},
    );
    expect(out.p1).toBeUndefined();
  });

  // ===== Manufacturer code (Kod producenta) — #412 =================

  it('fills manufacturer code verbatim onto Kod producenta', () => {
    const out = autoPrefillParameters(
      [param({ id: 'p1', name: 'Kod producenta', type: 'string' })],
      { manufacturerCode: 'ABC-123' },
    );
    expect(out.p1).toBe('ABC-123');
  });

  it('trims whitespace from manufacturer code before filling', () => {
    const out = autoPrefillParameters(
      [param({ id: 'p1', name: 'MPN', type: 'string' })],
      { manufacturerCode: '  ABC-123  ' },
    );
    expect(out.p1).toBe('ABC-123');
  });

  it('does not fill manufacturer code from SKU — variant.manufacturerCode is the deliberate source', () => {
    // Even if the param is `Kod producenta` and the variant has an EAN/SKU,
    // we never fill from SKU. Only `manufacturerCode` (a deliberate
    // attribute the BE writes) is consulted.
    const out = autoPrefillParameters(
      [param({ id: 'p1', name: 'Kod producenta', type: 'string' })],
      { ean: '5901234123457' /* no manufacturerCode */ },
    );
    expect(out.p1).toBeUndefined();
  });

  it('does not fill manufacturer code when variant value is whitespace-only', () => {
    // Defensive guard — `'   '` is truthy under `if (variant.manufacturerCode)`
    // but trims to empty. Pin the behaviour so a future refactor can't
    // accidentally drop the `if (trimmed)` guard.
    const out = autoPrefillParameters(
      [param({ id: 'p1', name: 'Kod producenta', type: 'string' })],
      { manufacturerCode: '   ' },
    );
    expect(out.p1).toBeUndefined();
  });

  // ===== Combined pipeline — #412 ==================================

  it('fills EAN, Stan, brand, and manufacturer code in a single pass', () => {
    // Locks the four rules into one pipeline run so a future tweak that
    // accidentally short-circuits the loop after the first match can't slip
    // by with only the per-rule tests above passing.
    const out = autoPrefillParameters(
      [
        param({ id: 'ean1', name: 'EAN (GTIN)', type: 'string' }),
        param({
          id: 'stan1',
          name: 'Stan',
          type: 'dictionary',
          dictionary: [
            { id: 'stan_new', value: 'Nowy' },
            { id: 'stan_used', value: 'Używany' },
          ],
        }),
        param({
          id: 'brand1',
          name: 'Marka',
          type: 'dictionary',
          dictionary: [{ id: 'brand_sony', value: 'Sony' }],
        }),
        param({ id: 'mpn1', name: 'Kod producenta', type: 'string' }),
      ],
      { ean: '5901234123457', brand: 'Sony', manufacturerCode: 'ABC-123' },
    );
    expect(out.ean1).toBe('5901234123457');
    expect(out.stan1).toBe('stan_new');
    expect(out.brand1).toBe('brand_sony');
    expect(out.mpn1).toBe('ABC-123');
  });
});

describe('collectUnmatchedBrandHints', () => {
  it('emits a hint when variant has brand but no dictionary entry matched', () => {
    const params: CategoryParameter[] = [
      param({
        id: 'p1',
        name: 'Marka',
        type: 'dictionary',
        dictionary: [{ id: 'p1_x', value: 'OtherBrand' }],
      }),
    ];
    const filled = autoPrefillParameters(params, { brand: 'Sony' });
    const hints = collectUnmatchedBrandHints(params, { brand: 'Sony' }, filled);
    expect(Object.keys(hints)).toEqual(['p1']);
    expect(hints.p1).toContain('Sony');
    expect(hints.p1).toMatch(/no exact match/i);
  });

  it('emits no hint when the brand was successfully filled', () => {
    const params: CategoryParameter[] = [
      param({
        id: 'p1',
        name: 'Marka',
        type: 'dictionary',
        dictionary: [{ id: 'p1_sony', value: 'Sony' }],
      }),
    ];
    const filled = autoPrefillParameters(params, { brand: 'Sony' });
    const hints = collectUnmatchedBrandHints(params, { brand: 'Sony' }, filled);
    expect(hints).toEqual({});
  });

  it('emits no hint when variant has no brand value', () => {
    const params: CategoryParameter[] = [
      param({ id: 'p1', name: 'Marka', type: 'dictionary', dictionary: [] }),
    ];
    expect(collectUnmatchedBrandHints(params, {}, {})).toEqual({});
  });

  it('emits hints across multiple unmatched Marka parameters', () => {
    const params: CategoryParameter[] = [
      param({ id: 'p1', name: 'Marka', type: 'dictionary', dictionary: [] }),
      param({ id: 'p2', name: 'Brand', type: 'dictionary', dictionary: [] }),
    ];
    const hints = collectUnmatchedBrandHints(params, { brand: 'Sony' }, {});
    expect(Object.keys(hints).sort()).toEqual(['p1', 'p2']);
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
