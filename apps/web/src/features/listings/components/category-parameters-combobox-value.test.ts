/**
 * Tests for the combobox <-> form value conversion of category parameters
 * (#4038): a dictionary pick on a custom-values field is stored as the entry's
 * text, so the submit resolves it to `valuesIds`.
 */
import { describe, expect, it } from 'vitest';

import type { CategoryParameter } from '../api/listings.types';
import { categoryParametersToOfferParameters } from './category-parameters-to-offer-parameters';
import { fromComboboxValue, toComboboxValue } from './category-parameters-step';

function param(partial: Partial<CategoryParameter> & { id: string }): CategoryParameter {
  return {
    name: partial.id,
    type: 'dictionary',
    required: false,
    restrictions: {},
    section: 'product',
    ...partial,
  } as CategoryParameter;
}

const material = param({
  id: '201017',
  restrictions: { customValuesEnabled: true },
  dictionary: [{ id: '201017_2317', value: 'bawełna' }],
});

describe('fromComboboxValue', () => {
  it('stores a dictionary pick on a custom-values field as the entry text', () => {
    expect(fromComboboxValue(material, { kind: 'dictionary', ids: ['201017_2317'] })).toBe('bawełna');
  });

  it('keeps free text on a custom-values field', () => {
    expect(fromComboboxValue(material, { kind: 'custom', text: 'len' })).toBe('len');
  });

  it('stores the entry id on a plain dictionary field', () => {
    const plain = param({ id: 'p1', dictionary: [{ id: 'p1_a', value: 'A' }] });
    expect(fromComboboxValue(plain, { kind: 'dictionary', ids: ['p1_a'] })).toBe('p1_a');
  });

  it('stores every id on a multi-choice field', () => {
    const multi = param({ id: 'p2', restrictions: { multipleChoices: true } });
    expect(fromComboboxValue(multi, { kind: 'dictionary', ids: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('round-trips a pick to the same combobox selection and to valuesIds on submit', () => {
    const stored = fromComboboxValue(material, { kind: 'dictionary', ids: ['201017_2317'] });
    expect(toComboboxValue(material, stored)).toEqual({ kind: 'dictionary', ids: ['201017_2317'] });
    expect(categoryParametersToOfferParameters({ '201017': stored }, [material])).toEqual([
      { id: '201017', valuesIds: ['201017_2317'], section: 'product' },
    ]);
  });
});
