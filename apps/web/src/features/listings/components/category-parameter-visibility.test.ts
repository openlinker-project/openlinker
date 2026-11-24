/**
 * Category-Parameter Visibility — unit tests
 *
 * Pins how a dependent parameter reads a custom-values dictionary parent
 * (#4038): the parent stores the entry's text, while `dependsOn.valueIds` and
 * `dependsOnValueIds` name entry ids, so the text must resolve back to an id.
 * Allegro's own example is Marka (custom values allowed) -> Model.
 *
 * @module apps/web/src/features/listings/components
 */
import { describe, expect, it } from 'vitest';
import type { CategoryParameter } from '../api/listings.types';
import { isParameterVisible, visibleDictionaryEntries } from './category-parameter-visibility';
import { fromComboboxValue } from './category-parameters-step';
import { categoryParametersToOfferParameters } from './category-parameters-to-offer-parameters';

function param(overrides: Partial<CategoryParameter>): CategoryParameter {
  return {
    id: 'x',
    name: 'X',
    type: 'string',
    required: false,
    restrictions: {},
    section: 'product',
    ...overrides,
  };
}

const brand = param({
  id: 'brand',
  name: 'Marka',
  type: 'dictionary',
  restrictions: { customValuesEnabled: true },
  dictionary: [
    { id: 'brand_samsung', value: 'Samsung' },
    { id: 'brand_apple', value: 'Apple' },
    { id: 'brand_other', value: 'inna' },
  ],
});

const model = param({
  id: 'model',
  name: 'Model',
  type: 'dictionary',
  dependsOn: { parameterId: 'brand', valueIds: ['brand_samsung', 'brand_apple'] },
  dictionary: [
    { id: 'model_s24', value: 'Galaxy S24', dependsOnValueIds: ['brand_samsung'] },
    { id: 'model_15', value: 'iPhone 15', dependsOnValueIds: ['brand_apple'] },
  ],
});

const parameters = [brand, model];

describe('category-parameter-visibility with a custom-values parent', () => {
  it('should show the dependent when the parent holds the picked entry text', () => {
    expect(isParameterVisible(model, { brand: 'Samsung' }, parameters)).toBe(true);
  });

  it('should match the parent text case-insensitively and ignore surrounding spaces', () => {
    expect(isParameterVisible(model, { brand: '  samsung ' }, parameters)).toBe(true);
  });

  it('should still show the dependent when the parent holds an entry id', () => {
    expect(isParameterVisible(model, { brand: 'brand_apple' }, parameters)).toBe(true);
  });

  it('should hide the dependent when the parent holds text naming no entry', () => {
    expect(isParameterVisible(model, { brand: 'Xiaomi' }, parameters)).toBe(false);
  });

  it('should hide the dependent when the parent names an entry it does not depend on', () => {
    expect(isParameterVisible(model, { brand: 'inna' }, parameters)).toBe(false);
  });

  it('should filter the dependent entries by the parent entry picked by text', () => {
    const entries = visibleDictionaryEntries(model, { brand: 'Samsung' }, parameters);
    expect(entries.map((e) => e.id)).toEqual(['model_s24']);
  });

  it('should show and send the dependent when the parent is picked from the combobox', () => {
    const brandValue = fromComboboxValue(brand, { kind: 'dictionary', ids: ['brand_samsung'] });
    const values = { brand: brandValue, model: 'model_s24' };

    expect(isParameterVisible(model, values, parameters)).toBe(true);
    expect(categoryParametersToOfferParameters(values, parameters)).toEqual([
      { id: 'brand', valuesIds: ['brand_samsung'], section: 'product' },
      { id: 'model', valuesIds: ['model_s24'], section: 'product' },
    ]);
  });

  it('should leave a parent without custom values compared by its stored id', () => {
    const plainBrand = param({ ...brand, restrictions: {} });
    expect(isParameterVisible(model, { brand: 'brand_samsung' }, [plainBrand, model])).toBe(true);
    expect(isParameterVisible(model, { brand: 'Samsung' }, [plainBrand, model])).toBe(false);
  });
});
