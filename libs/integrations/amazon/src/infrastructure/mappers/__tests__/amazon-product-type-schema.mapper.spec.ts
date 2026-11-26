/**
 * Amazon product type schema mapper tests (#4181)
 *
 * @module libs/integrations/amazon/src/infrastructure/mappers/__tests__
 */
import type { AmazonProductTypeSchema } from '../../../domain/types/amazon-product-type.types';
import { mapProductTypeSchemaToParameters } from '../amazon-product-type-schema.mapper';

const schema: AmazonProductTypeSchema = {
  required: ['item_name', 'brand', 'color', 'material', 'number_of_items', 'item_weight', 'other_product_image_locator_1', 'missing'],
  properties: {
    item_name: { title: 'Item name', items: { properties: { value: { type: 'string' } } } },
    color: { title: 'Colour', maxItems: 2, items: { properties: { value: { type: 'string', maxLength: 50 } } } },
    material: {
      title: 'Material',
      items: { properties: { value: { type: 'string', enum: ['ceramic', 'glass'], enumNames: ['Ceramic', 'Glass'] } } },
    },
    number_of_items: { title: 'Number of items', items: { properties: { value: { type: 'integer', minimum: 1 } } } },
    item_weight: { title: 'Weight', items: { properties: { unit: { type: 'string' } } } },
  },
};

describe('mapProductTypeSchemaToParameters', () => {
  it('should offer the required simple attributes the composer does not write itself', () => {
    const parameters = mapProductTypeSchemaToParameters(schema);

    expect(parameters.map((parameter) => parameter.id)).toEqual(['color', 'material', 'number_of_items']);
    expect(parameters[0]).toEqual({
      id: 'color',
      name: 'Colour',
      type: 'string',
      required: true,
      multiValue: true,
      restrictions: { maxLength: 50, multipleChoices: true, allowedNumberOfValues: 2 },
      section: 'product',
    });
    expect(parameters[1]).toMatchObject({
      type: 'dictionary',
      dictionary: [
        { id: 'ceramic', value: 'Ceramic' },
        { id: 'glass', value: 'Glass' },
      ],
    });
    expect(parameters[2]).toMatchObject({ type: 'integer', restrictions: { min: 1 } });
  });

  it('should offer nothing for a schema with no required attributes', () => {
    expect(mapProductTypeSchemaToParameters({ properties: {} })).toEqual([]);
  });
});
