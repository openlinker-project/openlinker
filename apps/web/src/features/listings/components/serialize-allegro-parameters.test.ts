/**
 * Serialize Allegro Parameters — unit tests
 *
 * @module apps/web/src/features/listings/components
 */
import { describe, expect, it } from 'vitest';
import type { CategoryParameter } from '../api/listings.types';
import { serializeAllegroParameters } from './serialize-allegro-parameters';

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

describe('serializeAllegroParameters', () => {
  it('emits dictionary single → valuesIds', () => {
    const meta = [param({ id: 'p1', type: 'dictionary' })];
    const { offerParameters } = serializeAllegroParameters({ p1: 'p1_a' }, meta);
    expect(offerParameters).toEqual([{ id: 'p1', valuesIds: ['p1_a'] }]);
  });

  it('emits dictionary multi → valuesIds with the array', () => {
    const meta = [param({ id: 'p1', type: 'dictionary', restrictions: { multipleChoices: true } })];
    const { offerParameters } = serializeAllegroParameters({ p1: ['a', 'b'] }, meta);
    expect(offerParameters).toEqual([{ id: 'p1', valuesIds: ['a', 'b'] }]);
  });

  it('customValues match → valuesIds (case-insensitive); no match → values', () => {
    const meta = [
      param({
        id: 'p1',
        type: 'dictionary',
        restrictions: { customValuesEnabled: true },
        dictionary: [{ id: 'p1_apple', value: 'Apple' }],
      }),
    ];
    const matched = serializeAllegroParameters({ p1: 'apple' }, meta).offerParameters;
    expect(matched).toEqual([{ id: 'p1', valuesIds: ['p1_apple'] }]);
    const free = serializeAllegroParameters({ p1: 'AcmeCorp' }, meta).offerParameters;
    expect(free).toEqual([{ id: 'p1', values: ['AcmeCorp'] }]);
  });

  it('emits scalar string/integer/float → values: [String(v)]', () => {
    const meta = [
      param({ id: 'p1', type: 'string' }),
      param({ id: 'p2', type: 'integer' }),
    ];
    const { offerParameters } = serializeAllegroParameters({ p1: 'abc', p2: '42' }, meta);
    expect(offerParameters).toEqual([
      { id: 'p1', values: ['abc'] },
      { id: 'p2', values: ['42'] },
    ]);
  });

  it('emits range → rangeValue', () => {
    const meta = [param({ id: 'p1', type: 'integer', restrictions: { range: true } })];
    const { offerParameters } = serializeAllegroParameters(
      { p1: { from: '1', to: '10' } },
      meta,
    );
    expect(offerParameters).toEqual([{ id: 'p1', rangeValue: { from: '1', to: '10' } }]);
  });

  it('drops empty values silently', () => {
    const meta = [
      param({ id: 'p1', type: 'string' }),
      param({ id: 'p2', type: 'dictionary' }),
      param({ id: 'p3', type: 'integer', restrictions: { range: true } }),
    ];
    const result = serializeAllegroParameters(
      { p1: '', p2: undefined, p3: { from: '', to: '' } },
      meta,
    );
    expect(result.offerParameters).toEqual([]);
    expect(result.productParameters).toEqual([]);
  });

  it('skips hidden parameters (parameter-level visibility)', () => {
    const meta = [
      param({ id: 'parent', type: 'dictionary' }),
      param({
        id: 'child',
        type: 'dictionary',
        dependsOn: { parameterId: 'parent', valueIds: ['p_yes'] },
        dictionary: [{ id: 'c_a', value: 'A' }],
      }),
    ];
    // parent value 'p_no' does NOT match the child's dependsOn
    const { offerParameters } = serializeAllegroParameters(
      { parent: 'p_no', child: 'c_a' },
      meta,
    );
    expect(offerParameters).toEqual([{ id: 'parent', valuesIds: ['p_no'] }]);
  });

  it('preserves submission order matching the parameters argument (anchors error mapping)', () => {
    const meta = [
      param({ id: 'a', type: 'string' }),
      param({ id: 'b', type: 'string' }),
      param({ id: 'c', type: 'string' }),
    ];
    const { offerParameters } = serializeAllegroParameters({ a: '1', b: '2', c: '3' }, meta);
    expect(offerParameters.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  describe('section split (#415)', () => {
    it("routes parameters with section: 'product' to productParameters", () => {
      const meta = [
        param({ id: 'p_ean', type: 'string', section: 'offer' }),
        param({ id: 'p_marka', type: 'dictionary', section: 'product' }),
      ];
      const { offerParameters, productParameters } = serializeAllegroParameters(
        { p_ean: '5901234567890', p_marka: 'p_marka_canon' },
        meta,
      );
      expect(offerParameters).toEqual([
        { id: 'p_ean', values: ['5901234567890'] },
      ]);
      expect(productParameters).toEqual([
        { id: 'p_marka', valuesIds: ['p_marka_canon'] },
      ]);
    });

    it('returns empty productParameters when no parameter is product-section', () => {
      const meta = [
        param({ id: 'p_ean', type: 'string', section: 'offer' }),
        param({ id: 'p_stan', type: 'dictionary', section: 'offer' }),
      ];
      const { offerParameters, productParameters } = serializeAllegroParameters(
        { p_ean: '111', p_stan: 'new' },
        meta,
      );
      expect(offerParameters).toHaveLength(2);
      expect(productParameters).toEqual([]);
    });

    it("preserves order within each section independently", () => {
      // Interleaved metadata — split must keep relative order in each output.
      const meta = [
        param({ id: 'a', type: 'string', section: 'offer' }),
        param({ id: 'b', type: 'string', section: 'product' }),
        param({ id: 'c', type: 'string', section: 'offer' }),
        param({ id: 'd', type: 'string', section: 'product' }),
      ];
      const { offerParameters, productParameters } = serializeAllegroParameters(
        { a: '1', b: '2', c: '3', d: '4' },
        meta,
      );
      expect(offerParameters.map((p) => p.id)).toEqual(['a', 'c']);
      expect(productParameters.map((p) => p.id)).toEqual(['b', 'd']);
    });
  });
});
