/**
 * Shoper Product Attributes Mapper
 *
 * Pure rules for turning one neutral publish `OfferParameter` into the value of
 * one Shoper attribute, and for deciding whether Shoper would keep it. The I/O
 * (reading attributes and groups) is the planner's; nothing here fetches or
 * throws, so every rule is testable as plain data.
 *
 * Live-verified write semantics (2026-10-23, product 95):
 *   - a select attribute takes the option TEXT. Its `option_id` and any text
 *     that is not one of its options are both refused with
 *     `400 Attribute '<id>' has invalid option value`, which fails the whole
 *     product write. So the value is checked against the options here, and a
 *     mismatch becomes a warning instead of a request.
 *   - an attribute whose group is not bound to the product's category is
 *     accepted (200) and silently NOT stored. That is checked here too, because
 *     sending it would report a value the shop does not hold.
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */
import type { OfferParameter } from '@openlinker/core/listings';

import type {
  ShoperAttribute,
  ShoperAttributeGroup,
  ShoperAttributeOption,
} from '../../domain/types/shoper-api.types';
import type { ShoperAttributeValueResolution } from '../../domain/types/shoper-product-write.types';

/** Shoper's documented attribute types. Only select is verified live. */
const SHOPER_ATTRIBUTE_TYPE_TEXT = '0';
const SHOPER_ATTRIBUTE_TYPE_CHECKBOX = '1';
const SHOPER_ATTRIBUTE_TYPE_SELECT = '2';

/** A Shoper id as a string, or `null` when the value is not a positive integer. */
export function readShoperId(value: string | number | null | undefined): string | null {
  const id = value === null || value === undefined ? '' : String(value).trim();
  return /^\d+$/.test(id) && Number(id) > 0 ? id : null;
}

/** Case- and surrounding-whitespace-insensitive key for comparing names and option texts. */
function normalise(text: string): string {
  return text.trim().toLocaleLowerCase();
}

/** How a warning names an attribute: its shop name when known, always its id. */
export function describeShoperAttribute(attribute: ShoperAttribute | null, attributeId: string): string {
  const name = typeof attribute?.name === 'string' ? attribute.name.trim() : '';
  return name.length > 0 ? `"${name}" (attribute ${attributeId})` : `attribute ${attributeId}`;
}

/** The attributes whose name matches `name`, ignoring case and surrounding whitespace. */
export function findShoperAttributesByName(
  rows: readonly ShoperAttribute[],
  name: string,
): ShoperAttribute[] {
  const wanted = normalise(name);
  if (wanted.length === 0) {
    return [];
  }
  return rows.filter(
    (row) => typeof row.name === 'string' && normalise(row.name) === wanted && readShoperId(row.attribute_id) !== null,
  );
}

/**
 * Whether Shoper would store a value for an attribute of `group` on a product
 * whose main category is `categoryId`. A group that cannot be found counts as
 * unbound: its binding cannot be shown, and a silently dropped value is the
 * outcome being avoided.
 */
export function isShoperAttributeGroupBound(
  group: ShoperAttributeGroup | undefined,
  categoryId: number,
): boolean {
  if (group === undefined || !Array.isArray(group.categories)) {
    return false;
  }
  return (group.categories as readonly (string | number)[]).some((id) => Number(id) === categoryId);
}

/** The group an attribute belongs to, looked up in the shop's group list. */
export function findShoperAttributeGroup(
  groups: readonly ShoperAttributeGroup[],
  attribute: ShoperAttribute,
): ShoperAttributeGroup | undefined {
  const groupId = readShoperId(attribute.attribute_group_id);
  if (groupId === null) {
    return undefined;
  }
  return groups.find((group) => readShoperId(group.attribute_group_id) === groupId);
}

function optionsOf(attribute: ShoperAttribute): ShoperAttributeOption[] {
  return Array.isArray(attribute.options) ? [...(attribute.options as readonly ShoperAttributeOption[])] : [];
}

function optionText(option: ShoperAttributeOption): string | null {
  const text = typeof option.value === 'string' ? option.value.trim() : '';
  return text.length > 0 ? text : null;
}

function firstNonEmpty(values: readonly string[] | undefined): string | null {
  for (const value of values ?? []) {
    if (value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function onlyFirstWarning(label: string, count: number): string | undefined {
  return count > 1
    ? `Only the first value of ${label} was sent: a Shoper attribute holds one value per product.`
    : undefined;
}

function withOptionalWarning(value: string, warning: string | undefined): ShoperAttributeValueResolution {
  return warning === undefined ? { ok: true, value } : { ok: true, value, warning };
}

/**
 * The value `param` sets on `attribute`, or why it sets none.
 *
 * `trustValueIds` is true only when the parameter named the Shoper attribute by
 * its id (the attribute picker's linkage). A parameter matched by NAME may come
 * from another platform's projection, whose `valuesIds` are that platform's
 * dictionary ids: compared against Shoper option ids they could pick an
 * unrelated option, so only the text is used then.
 */
export function resolveShoperAttributeValue(
  param: OfferParameter,
  attribute: ShoperAttribute,
  attributeId: string,
  trustValueIds: boolean,
): ShoperAttributeValueResolution {
  const label = describeShoperAttribute(attribute, attributeId);
  const type = attribute.type === null || attribute.type === undefined ? '' : String(attribute.type).trim();
  const options = optionsOf(attribute);

  if (type === SHOPER_ATTRIBUTE_TYPE_CHECKBOX) {
    // How Shoper expects a checkbox value is documented but not verified, and a
    // wrong guess fails the whole product write.
    return { ok: false, warning: `${label} is a checkbox attribute, which is not published to Shoper yet.` };
  }

  if (type === SHOPER_ATTRIBUTE_TYPE_TEXT) {
    const text = firstNonEmpty(param.values);
    if (text === null) {
      return { ok: false, warning: `${label} was not sent: the parameter carries no text value.` };
    }
    return withOptionalWarning(text, onlyFirstWarning(label, param.values?.length ?? 0));
  }

  if (type !== SHOPER_ATTRIBUTE_TYPE_SELECT && options.length === 0) {
    return { ok: false, warning: `${label} has a type this publisher does not write (${type || 'none'}).` };
  }

  return resolveSelectValue(param, options, label, trustValueIds);
}

function resolveSelectValue(
  param: OfferParameter,
  options: readonly ShoperAttributeOption[],
  label: string,
  trustValueIds: boolean,
): ShoperAttributeValueResolution {
  const valueIds = trustValueIds ? (param.valuesIds ?? []) : [];
  const texts = param.values ?? [];
  const count = Math.max(valueIds.length, texts.length);

  const wantedId = valueIds.length > 0 ? readShoperId(valueIds[0]) : null;
  if (wantedId !== null) {
    const byId = options.find((option) => readShoperId(option.option_id) === wantedId);
    const text = byId === undefined ? null : optionText(byId);
    if (text !== null) {
      return withOptionalWarning(text, onlyFirstWarning(label, count));
    }
  }

  const wantedText = firstNonEmpty(texts);
  if (wantedText !== null) {
    const byText = options.find((option) => {
      const text = optionText(option);
      return text !== null && normalise(text) === normalise(wantedText);
    });
    const text = byText === undefined ? null : optionText(byText);
    if (text !== null) {
      // The shop's own spelling is sent: Shoper compares the text exactly.
      return withOptionalWarning(text, onlyFirstWarning(label, count));
    }
    return {
      ok: false,
      warning:
        `${label} was not sent: "${wantedText}" is not one of its options in the shop, ` +
        'and Shoper refuses a value outside them. Add the option in Shoper or pick an existing one.',
    };
  }

  if (wantedId !== null) {
    return {
      ok: false,
      warning: `${label} was not sent: option ${wantedId} is not one of its options in the shop.`,
    };
  }
  return { ok: false, warning: `${label} was not sent: the parameter carries no value.` };
}
