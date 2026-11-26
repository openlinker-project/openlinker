/**
 * Mirakl Category Parameter Policy
 *
 * Maps PM11 card attributes (with their VL11 values) onto core's neutral
 * `CategoryParameter`. Card attributes describe the product card, so every
 * parameter is `section: 'product'`. An attribute type this plugin does not
 * know is read as text rather than dropped, so a required one is still asked
 * for.
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import type { CategoryParameter, CategoryParameterType } from '@openlinker/core/listings';
import type { MiraklProductAttribute, MiraklValueList } from '../types/mirakl-catalog.types';

const TYPE_BY_MIRAKL: Readonly<Record<string, CategoryParameterType>> = {
  INTEGER: 'integer',
  DECIMAL: 'float',
  LIST: 'dictionary',
  LIST_MULTIPLE_VALUES: 'dictionary',
};

export function mapMiraklAttribute(
  attribute: MiraklProductAttribute,
  valueList: MiraklValueList | undefined
): CategoryParameter | null {
  if (!attribute.code) {
    return null;
  }
  const type = TYPE_BY_MIRAKL[(attribute.type ?? '').toUpperCase()] ?? 'string';
  const multi = (attribute.type ?? '').toUpperCase() === 'LIST_MULTIPLE_VALUES';
  const dictionary =
    type === 'dictionary'
      ? (valueList?.values ?? [])
          .filter((value) => value.code)
          .map((value) => ({
            id: value.code as string,
            value: value.label?.trim() || (value.code as string),
          }))
      : undefined;
  return {
    id: attribute.code,
    name: attribute.label?.trim() || attribute.code,
    // A LIST whose values could not be read is offered as free text, so the
    // operator can still fill it.
    type: type === 'dictionary' && (dictionary?.length ?? 0) === 0 ? 'string' : type,
    required: attribute.required === true,
    ...(multi && { multiValue: true }),
    ...(dictionary && dictionary.length > 0 && { dictionary }),
    restrictions: multi ? { multipleChoices: true } : {},
    section: 'product',
  };
}
