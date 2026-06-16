/**
 * Tests for `categoryParametersToOfferParameters` (#1071) — form values →
 * neutral, section-tagged `OfferParameter[]`.
 */
import { describe, expect, it } from 'vitest';

import type { CategoryParameter } from '../api/listings.types';
import {
  MissingCategoryParameterSectionError,
  categoryParametersToOfferParameters,
} from './category-parameters-to-offer-parameters';

function param(partial: Partial<CategoryParameter> & { id: string }): CategoryParameter {
  return {
    name: partial.id,
    type: 'dictionary',
    required: false,
    restrictions: {},
    section: 'offer',
    ...partial,
  } as CategoryParameter;
}

describe('categoryParametersToOfferParameters', () => {
  it('maps a single dictionary value to valuesIds', () => {
    const meta = [param({ id: 'p1' })];
    expect(categoryParametersToOfferParameters({ p1: 'p1_a' }, meta)).toEqual([
      { id: 'p1', valuesIds: ['p1_a'], section: 'offer' },
    ]);
  });

  it('maps a multi-choice dictionary to a valuesIds array', () => {
    const meta = [param({ id: 'p1', restrictions: { multipleChoices: true } })];
    expect(categoryParametersToOfferParameters({ p1: ['a', 'b'] }, meta)).toEqual([
      { id: 'p1', valuesIds: ['a', 'b'], section: 'offer' },
    ]);
  });

  it('resolves a custom-values dictionary: matched → valuesIds, free → values', () => {
    const meta = [
      param({
        id: 'p1',
        restrictions: { customValuesEnabled: true },
        dictionary: [{ id: 'd1', value: 'Apple' }],
      }),
    ];
    expect(categoryParametersToOfferParameters({ p1: 'apple' }, meta)).toEqual([
      { id: 'p1', valuesIds: ['d1'], section: 'offer' },
    ]);
    expect(categoryParametersToOfferParameters({ p1: 'AcmeCorp' }, meta)).toEqual([
      { id: 'p1', values: ['AcmeCorp'], section: 'offer' },
    ]);
  });

  it('maps a scalar string to values', () => {
    const meta = [param({ id: 'p1', type: 'string' })];
    expect(categoryParametersToOfferParameters({ p1: 'abc' }, meta)).toEqual([
      { id: 'p1', values: ['abc'], section: 'offer' },
    ]);
  });

  it('maps an integer/float range to rangeValue', () => {
    const meta = [param({ id: 'p1', type: 'float', restrictions: { range: true } })];
    expect(
      categoryParametersToOfferParameters({ p1: { from: '1.0', to: '5.0' } }, meta),
    ).toEqual([{ id: 'p1', rangeValue: { from: '1.0', to: '5.0' }, section: 'offer' }]);
  });

  it('excludes empty values', () => {
    const meta = [param({ id: 'p1', type: 'string' })];
    expect(categoryParametersToOfferParameters({ p1: '   ' }, meta)).toEqual([]);
  });

  it('tags each parameter with its section and keeps a single flat array', () => {
    const meta = [
      param({ id: 'ean', type: 'string', section: 'offer' }),
      param({ id: 'brand', type: 'string', section: 'product' }),
    ];
    expect(categoryParametersToOfferParameters({ ean: '123', brand: 'Canon' }, meta)).toEqual([
      { id: 'ean', values: ['123'], section: 'offer' },
      { id: 'brand', values: ['Canon'], section: 'product' },
    ]);
  });

  it('throws MissingCategoryParameterSectionError when section is absent (stale cache)', () => {
    const meta = [param({ id: 'p1', type: 'string', section: undefined as never })];
    expect(() => categoryParametersToOfferParameters({ p1: 'x' }, meta)).toThrow(
      MissingCategoryParameterSectionError,
    );
  });
});
