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

describe('toComboboxValue', () => {
  it('shows a custom-values entry stored by its text as the picked entry', () => {
    expect(toComboboxValue(material, 'bawełna')).toEqual({
      kind: 'dictionary',
      ids: ['201017_2317'],
    });
  });

  it('shows a custom-values entry stored by its id as the picked entry, not as text', () => {
    expect(toComboboxValue(material, '201017_2317')).toEqual({
      kind: 'dictionary',
      ids: ['201017_2317'],
    });
  });

  it('shows free text that names no entry as custom text', () => {
    expect(toComboboxValue(material, 'len')).toEqual({ kind: 'custom', text: 'len' });
  });
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

  // Review of #4099: two entries with the same label. Text would resolve to the
  // first one, so the pick is stored by id and resolves back to the exact entry.
  it('keeps the exact entry when two entries share a label', () => {
    const duplicate = param({
      id: '201017',
      restrictions: { customValuesEnabled: true },
      dictionary: [
        { id: '201017_1', value: 'Bawełna' },
        { id: '201017_2', value: 'bawełna ' },
        { id: '201017_3', value: 'len' },
      ],
    });

    const stored = fromComboboxValue(duplicate, { kind: 'dictionary', ids: ['201017_2'] });
    expect(stored).toBe('201017_2');
    expect(toComboboxValue(duplicate, stored)).toEqual({ kind: 'dictionary', ids: ['201017_2'] });
    expect(categoryParametersToOfferParameters({ '201017': stored }, [duplicate])).toEqual([
      { id: '201017', valuesIds: ['201017_2'], section: 'product' },
    ]);
    // A label that names one entry is still stored as its text.
    expect(fromComboboxValue(duplicate, { kind: 'dictionary', ids: ['201017_3'] })).toBe('len');
  });
});
