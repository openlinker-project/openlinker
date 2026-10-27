/**
 * Shoper Attribute Mapper
 *
 * Maps Shoper's product attributes onto the neutral `ShopAttribute` /
 * `ShopAttributeTerm` the structured attribute picker reads (#1835).
 *
 * Shoper's model differs from WooCommerce's global attributes, and the mapping
 * says so rather than pretending otherwise:
 *   - an ATTRIBUTE maps to `ShopAttribute`; the attribute GROUP it belongs to is
 *     not surfaced (it only scopes attributes to categories, and the neutral
 *     contract has no slot for it);
 *   - a select attribute's predefined `options` map to terms; a text-field or
 *     checkbox attribute carries none, so it has no terms and stays a free value;
 *   - Shoper has no slug, so the `slug` is the numeric id: the only key that
 *     survives a rename. A slug derived from the name would change with it.
 *
 * Rows with no id or no name are dropped, not labelled: a placeholder name
 * would read as a real one (the category mapper's rule).
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */
import type { ShopAttribute, ShopAttributeTerm } from '@openlinker/core/listings';

import type { ShoperAttribute, ShoperAttributeOption } from '../../domain/types/shoper-api.types';

function readId(value: string | number | null | undefined): string | null {
  const id = value === null || value === undefined ? '' : String(value).trim();
  return /^\d+$/.test(id) ? id : null;
}

function readText(value: string | null | undefined): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}

/** The attributes as neutral `ShopAttribute`s, sorted by name so the picker is stable. */
export function mapShoperAttributes(rows: readonly ShoperAttribute[]): ShopAttribute[] {
  const seen = new Set<string>();
  const attributes: ShopAttribute[] = [];
  for (const row of rows) {
    const id = readId(row.attribute_id);
    const name = readText(row.name);
    if (id === null || name === null || seen.has(id)) {
      continue;
    }
    seen.add(id);
    attributes.push({ id, name, slug: id });
  }
  return attributes.sort((a, b) => a.name.localeCompare(b.name) || Number(a.id) - Number(b.id));
}

function orderOf(option: ShoperAttributeOption): number {
  const order = Number(option.order);
  return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
}

/**
 * The predefined values of one attribute, in the shop's own order (then by id).
 * An attribute with no `options` (text field, checkbox, or an unreadable list)
 * has no terms.
 */
export function mapShoperAttributeTerms(attribute: ShoperAttribute | null | undefined): ShopAttributeTerm[] {
  const options = attribute?.options;
  if (!Array.isArray(options)) {
    return [];
  }
  const seen = new Set<string>();
  const terms: Array<ShopAttributeTerm & { order: number }> = [];
  for (const option of options as readonly ShoperAttributeOption[]) {
    const id = readId(option.option_id);
    const name = readText(option.value);
    if (id === null || name === null || seen.has(id)) {
      continue;
    }
    seen.add(id);
    terms.push({ id, name, slug: id, order: orderOf(option) });
  }
  return terms
    .sort((a, b) => a.order - b.order || Number(a.id) - Number(b.id))
    .map(({ id, name, slug }) => ({ id, name, slug }));
}
