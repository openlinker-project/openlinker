/**
 * Amazon Product Type Schema Mapper (#4181)
 *
 * Turns a product type's JSON Schema into the neutral `CategoryParameter`
 * list the wizard and the attribute projection read (ADR-023).
 *
 * Only what the wizard can express is offered:
 *   - attributes the schema lists as REQUIRED at the top level. Conditional
 *     requirements (`allOf` / `if` / `then`) are not read; Amazon reports a
 *     missed one as an issue after the create, which the status read shows.
 *   - simple attributes, whose value sits under `items.properties.value`. A
 *     required attribute shaped otherwise (a value with a unit, a nested
 *     group) cannot be filled from the wizard and is left out.
 *   - not the attributes the listing composer writes itself (title, brand,
 *     EAN, description, images and the offer), which would otherwise appear
 *     twice.
 *
 * An enum becomes a dictionary whose entry id IS the value Amazon expects, so
 * a picked entry is written back unchanged.
 *
 * @module libs/integrations/amazon/src/infrastructure/mappers
 */
import type {
  CategoryParameter,
  CategoryParameterDictionaryEntry,
  CategoryParameterType,
} from '@openlinker/core/listings';

import type {
  AmazonProductTypeSchema,
  AmazonSchemaAttribute,
  AmazonSchemaValue,
} from '../../domain/types/amazon-product-type.types';

/** Written by `composeFullListing` itself; never offered as a parameter. */
export const AMAZON_COMPOSED_ATTRIBUTES: ReadonlySet<string> = new Set([
  'item_name',
  'brand',
  'externally_assigned_product_identifier',
  'merchant_suggested_asin',
  'product_description',
  'main_product_image_locator',
  'condition_type',
  'purchasable_offer',
  'fulfillment_availability',
]);

export function mapProductTypeSchemaToParameters(schema: AmazonProductTypeSchema): CategoryParameter[] {
  const required = new Set(schema.required ?? []);
  const parameters: CategoryParameter[] = [];
  for (const name of required) {
    if (AMAZON_COMPOSED_ATTRIBUTES.has(name) || /^other_product_image_locator_\d+$/.test(name)) {
      continue;
    }
    const attribute = schema.properties?.[name];
    const value = attribute?.items?.properties?.value;
    if (attribute === undefined || value === undefined) {
      continue;
    }
    parameters.push(toParameter(name, attribute, value));
  }
  return parameters;
}

function toParameter(name: string, attribute: AmazonSchemaAttribute, value: AmazonSchemaValue): CategoryParameter {
  const dictionary = toDictionary(value);
  const multiValue = (attribute.maxItems ?? 1) > 1;
  return {
    id: name,
    name: attribute.title ?? name,
    type: dictionary ? 'dictionary' : scalarType(value),
    required: true,
    ...(multiValue ? { multiValue: true } : {}),
    ...(dictionary ? { dictionary } : {}),
    restrictions: {
      ...(value.minLength !== undefined ? { minLength: value.minLength } : {}),
      ...(value.maxLength !== undefined ? { maxLength: value.maxLength } : {}),
      ...(value.minimum !== undefined ? { min: value.minimum } : {}),
      ...(value.maximum !== undefined ? { max: value.maximum } : {}),
      ...(multiValue ? { multipleChoices: true, allowedNumberOfValues: attribute.maxItems } : {}),
    },
    section: 'product',
  };
}

function toDictionary(value: AmazonSchemaValue): CategoryParameterDictionaryEntry[] | undefined {
  if (value.enum === undefined || value.enum.length === 0) {
    return undefined;
  }
  return value.enum.map((entry, index) => ({
    id: String(entry),
    value: value.enumNames?.[index] ?? String(entry),
  }));
}

function scalarType(value: AmazonSchemaValue): CategoryParameterType {
  const types: readonly string[] = typeof value.type === 'string' ? [value.type] : (value.type ?? []);
  if (types.includes('integer')) {
    return 'integer';
  }
  if (types.includes('number')) {
    return 'float';
  }
  return 'string';
}
