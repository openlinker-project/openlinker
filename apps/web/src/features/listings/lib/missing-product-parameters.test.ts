import { describe, expect, it } from 'vitest';

import type { CategoryParameter } from '../api/listings.types';
import { missingRequiredProductParameterNames } from './missing-product-parameters';

const param = (over: Partial<CategoryParameter>): CategoryParameter =>
  ({
    id: 'p',
    name: 'Param',
    type: 'string',
    required: true,
    restrictions: {},
    section: 'product',
    ...over,
  }) as CategoryParameter;

describe('missingRequiredProductParameterNames', () => {
  const schema = [
    param({ id: 'model', name: 'Model' }),
    param({ id: 'code', name: 'Kod producenta' }),
    param({ id: 'state', name: 'Stan', section: 'offer' }),
    param({ id: 'opt', name: 'Kolor', required: false }),
    param({ id: 'dep', name: 'Rozmiar', dependsOn: { parameterId: 'x', valueIds: ['1'] } }),
  ];

  it('should name required product parameters with no value when none are filled', () => {
    expect(missingRequiredProductParameterNames(schema, {})).toEqual(['Model', 'Kod producenta']);
  });

  it('should drop a parameter when it has a value', () => {
    expect(missingRequiredProductParameterNames(schema, { model: 'Runner' })).toEqual(['Kod producenta']);
  });

  it('should treat blank strings, empty arrays and an empty range as missing', () => {
    expect(
      missingRequiredProductParameterNames(
        [param({ id: 'a', name: 'A' }), param({ id: 'b', name: 'B' }), param({ id: 'c', name: 'C' })],
        { a: '  ', b: [''], c: { from: '', to: ' ' } },
      ),
    ).toEqual(['A', 'B', 'C']);
  });

  it('should return an empty list when every required product parameter is filled', () => {
    expect(missingRequiredProductParameterNames(schema, { model: 'Runner', code: ['X1'] })).toEqual([]);
  });
});
