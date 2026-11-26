/**
 * Mirakl Category Parameter Policy: unit tests
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import { mapMiraklAttribute } from '../mirakl-category-parameter.policy';

describe('mapMiraklAttribute', () => {
  it('should map a LIST attribute with its values as a product dictionary', () => {
    expect(
      mapMiraklAttribute(
        { code: '650', label: 'Zestaw', type: 'LIST', values_list: 'TAK_NIE', required: false },
        {
          code: 'TAK_NIE',
          values: [
            { code: 'Y', label: 'Tak' },
            { code: 'N', label: 'Nie' },
          ],
        }
      )
    ).toEqual({
      id: '650',
      name: 'Zestaw',
      type: 'dictionary',
      required: false,
      dictionary: [
        { id: 'Y', value: 'Tak' },
        { id: 'N', value: 'Nie' },
      ],
      restrictions: {},
      section: 'product',
    });
  });

  it('should map numbers and multi-value lists, and read an unknown type as text', () => {
    expect(
      mapMiraklAttribute({ code: '2039', type: 'INTEGER', required: true }, undefined)
    ).toMatchObject({
      type: 'integer',
      required: true,
    });
    expect(
      mapMiraklAttribute(
        { code: 'M', type: 'LIST_MULTIPLE_VALUES', values_list: 'L' },
        { values: [{ code: 'a' }] }
      )
    ).toMatchObject({
      type: 'dictionary',
      multiValue: true,
      restrictions: { multipleChoices: true },
    });
    expect(mapMiraklAttribute({ code: 'X', type: 'MEDIA' }, undefined)).toMatchObject({
      type: 'string',
    });
  });

  it('should offer a list whose values could not be read as free text', () => {
    expect(
      mapMiraklAttribute({ code: 'L', type: 'LIST', values_list: 'GONE' }, undefined)
    ).toMatchObject({
      type: 'string',
    });
  });

  it('should skip an attribute without a code', () => {
    expect(mapMiraklAttribute({ label: 'no code' }, undefined)).toBeNull();
  });
});
