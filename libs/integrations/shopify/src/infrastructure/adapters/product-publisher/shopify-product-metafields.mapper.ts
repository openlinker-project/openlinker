/**
 * Shopify Product Metafields Mapper
 *
 * Pure mapping from the neutral publish `parameters` to product metafields
 * (`metafieldsSet` inputs), plus the metafield-definition view behind
 * `ShopAttributeReader`. No I/O.
 *
 * Two kinds of parameter:
 *   - LINKED: its `id` is `namespace.key` of a product metafield definition the
 *     shop has (what `ShopAttributeReader.listAttributes` returns, picked in the
 *     publish edit flow). Written into that definition with the definition's
 *     own type, so the shop's storefront filters and theme see it.
 *   - FREE TEXT: anything else (attribute-mapping rules, #1841, emit the
 *     destination parameter NAME). Written into the `openlinker` namespace,
 *     key = a slug of the name; one value is a `single_line_text_field`,
 *     several a `list.single_line_text_field`.
 *
 * Reference-typed definitions (`*_reference`, which is what the taxonomy
 * category attributes in the `shopify` namespace are: metaobjects of type
 * `shopify--color-pattern` and the like) are not written: a value there is a
 * metaobject GID, and the neutral command carries only text.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/product-publisher
 */
import type { OfferParameter } from '@openlinker/core/listings';

import { toShopifyHandle } from './shopify-product-publish.mapper';

/** Namespace of the free-text parameters OpenLinker writes. */
export const OPENLINKER_METAFIELD_NAMESPACE = 'openlinker';

const KEY_MIN = 2;
const KEY_MAX = 64;
const SINGLE_LINE_MAX = 255;

/** Scalar metafield types whose value is a plain string. Their `list.` form takes a JSON array. */
const TEXT_LIKE_SCALARS = new Set([
  'single_line_text_field',
  'multi_line_text_field',
  'number_integer',
  'number_decimal',
  'boolean',
  'date',
  'date_time',
  'color',
  'url',
]);

/** Types that hold several values joined into one text. */
const JOINABLE_TYPES = new Set(['single_line_text_field', 'multi_line_text_field']);

export interface ShopifyMetafieldDefinitionNode {
  readonly id: string;
  readonly name: string;
  readonly namespace: string;
  readonly key: string;
  readonly type: { readonly name: string };
  readonly validations: ReadonlyArray<{ readonly name: string; readonly value: string | null }>;
}

export interface MetafieldWrite {
  readonly namespace: string;
  readonly key: string;
  readonly type: string;
  readonly value: string;
}

export interface MetafieldPlan {
  readonly writes: readonly MetafieldWrite[];
  readonly warnings: readonly string[];
}

/** `namespace.key`, the id a definition is offered and linked by. */
export function definitionRef(def: { readonly namespace: string; readonly key: string }): string {
  return `${def.namespace}.${def.key}`;
}

/** Whether a value of this metafield type can be written from text (no references, no JSON objects). */
export function isWritableMetafieldType(type: string): boolean {
  const scalar = type.startsWith('list.') ? type.slice('list.'.length) : type;
  return TEXT_LIKE_SCALARS.has(scalar);
}

/** The definition's predefined values (`choices` validation), or [] for a free-value definition. */
export function definitionChoices(def: ShopifyMetafieldDefinitionNode): string[] {
  const raw = def.validations.find((v) => v.name === 'choices')?.value;
  if (raw === null || raw === undefined) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

/** A metafield key from a parameter name: `[a-z0-9_]`, 2..64 characters. */
export function toMetafieldKey(name: string): string {
  const slug = toShopifyHandle(name).replace(/-/g, '_').slice(0, KEY_MAX);
  return slug.length >= KEY_MIN ? slug : `p_${slug}`.slice(0, KEY_MAX);
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, SINGLE_LINE_MAX);
}

/** The text values a parameter states, or [] when it carries only dictionary ids. */
function textValues(param: OfferParameter): string[] {
  if (param.rangeValue !== undefined) {
    return [`${param.rangeValue.from}-${param.rangeValue.to}`];
  }
  return (param.values ?? []).map((v) => v.trim()).filter((v) => v.length > 0);
}

function valueFor(type: string, values: readonly string[]): string {
  if (type.startsWith('list.')) {
    return JSON.stringify(values.map(singleLine));
  }
  if (type === 'multi_line_text_field') {
    return values.join('\n');
  }
  if (type === 'single_line_text_field') {
    return singleLine(values.join(', '));
  }
  return values[0];
}

/**
 * The metafield writes for a publish's parameters, one per parameter, and a
 * warning for every parameter left out. `definitions` is keyed by
 * `namespace.key`; null means the definitions could not be read, so a
 * `namespace.key` id is written as free text rather than guessed at.
 */
export function planMetafields(
  parameters: readonly OfferParameter[],
  definitions: ReadonlyMap<string, ShopifyMetafieldDefinitionNode> | null,
): MetafieldPlan {
  const writes: MetafieldWrite[] = [];
  const warnings: string[] = [];
  const taken = new Set<string>();

  for (const param of parameters) {
    const values = textValues(param);
    if (values.length === 0) {
      warnings.push(
        `The parameter "${param.id}" was not sent: it carries no text value, and Shopify metafields take text.`,
      );
      continue;
    }

    const linked = definitions?.get(param.id);
    let write: MetafieldWrite;
    if (linked !== undefined) {
      const type = linked.type.name;
      if (!isWritableMetafieldType(type)) {
        warnings.push(
          `The parameter "${param.id}" was not sent: its Shopify metafield is of type ${type}, ` +
            'which takes a reference (for example a taxonomy value), not text.',
        );
        continue;
      }
      if (!type.startsWith('list.') && !JOINABLE_TYPES.has(type) && values.length > 1) {
        warnings.push(`The parameter "${param.id}" has several values; Shopify keeps only the first (${values[0]}).`);
      }
      write = { namespace: linked.namespace, key: linked.key, type, value: valueFor(type, values) };
    } else {
      const type = values.length > 1 ? 'list.single_line_text_field' : 'single_line_text_field';
      write = {
        namespace: OPENLINKER_METAFIELD_NAMESPACE,
        key: toMetafieldKey(param.id),
        type,
        value: valueFor(type, values),
      };
    }

    const ref = definitionRef(write);
    if (taken.has(ref)) {
      warnings.push(`The parameter "${param.id}" was not sent: another parameter already writes ${ref}.`);
      continue;
    }
    taken.add(ref);
    writes.push(write);
  }
  return { writes, warnings };
}
