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
    ...overrides,
  };
}

describe('serializeAllegroParameters', () => {
  it('emits dictionary single → valuesIds', () => {
    const meta = [param({ id: 'p1', type: 'dictionary' })];
    const { submitted } = serializeAllegroParameters({ p1: 'p1_a' }, meta);
    expect(submitted).toEqual([{ id: 'p1', valuesIds: ['p1_a'] }]);
  });

  it('emits dictionary multi → valuesIds with the array', () => {
    const meta = [param({ id: 'p1', type: 'dictionary', restrictions: { multipleChoices: true } })];
    const { submitted } = serializeAllegroParameters({ p1: ['a', 'b'] }, meta);
    expect(submitted).toEqual([{ id: 'p1', valuesIds: ['a', 'b'] }]);
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
    const matched = serializeAllegroParameters({ p1: 'apple' }, meta).submitted;
    expect(matched).toEqual([{ id: 'p1', valuesIds: ['p1_apple'] }]);
    const free = serializeAllegroParameters({ p1: 'AcmeCorp' }, meta).submitted;
    expect(free).toEqual([{ id: 'p1', values: ['AcmeCorp'] }]);
  });

  it('emits scalar string/integer/float → values: [String(v)]', () => {
    const meta = [
      param({ id: 'p1', type: 'string' }),
      param({ id: 'p2', type: 'integer' }),
    ];
    const { submitted } = serializeAllegroParameters({ p1: 'abc', p2: '42' }, meta);
    expect(submitted).toEqual([
      { id: 'p1', values: ['abc'] },
      { id: 'p2', values: ['42'] },
    ]);
  });

  it('emits range → rangeValue', () => {
    const meta = [param({ id: 'p1', type: 'integer', restrictions: { range: true } })];
    const { submitted } = serializeAllegroParameters({ p1: { from: '1', to: '10' } }, meta);
    expect(submitted).toEqual([{ id: 'p1', rangeValue: { from: '1', to: '10' } }]);
  });

  it('drops empty values silently', () => {
    const meta = [
      param({ id: 'p1', type: 'string' }),
      param({ id: 'p2', type: 'dictionary' }),
      param({ id: 'p3', type: 'integer', restrictions: { range: true } }),
    ];
    const { submitted } = serializeAllegroParameters(
      { p1: '', p2: undefined, p3: { from: '', to: '' } },
      meta,
    );
    expect(submitted).toEqual([]);
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
    const { submitted } = serializeAllegroParameters(
      { parent: 'p_no', child: 'c_a' },
      meta,
    );
    expect(submitted).toEqual([{ id: 'parent', valuesIds: ['p_no'] }]);
  });

  it('preserves submission order matching the parameters argument (anchors error mapping)', () => {
    const meta = [
      param({ id: 'a', type: 'string' }),
      param({ id: 'b', type: 'string' }),
      param({ id: 'c', type: 'string' }),
    ];
    const { submitted } = serializeAllegroParameters({ a: '1', b: '2', c: '3' }, meta);
    expect(submitted.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});
