/**
 * Attribute Mapping Rule Domain Types
 *
 * Operator-authored, deterministic rule layer (#1841) consumed by attribute
 * projection to fill destination attributes/parameters across many products.
 * Platform-agnostic: the same rules serve marketplace parameters and shop
 * (WooCommerce) attributes because projection is the shared integration point.
 *
 * @module libs/core/src/mappings/domain/types
 */

/**
 * The three rule kinds:
 *  - `fixed`       - set the destination parameter to a constant value.
 *  - `copy-remap`  - copy a source attribute, with optional per-value remap.
 *  - `place-value` - fill from product metadata (name/variant/manufacturer/...).
 */
export const AttributeMappingRuleKindValues = ['fixed', 'copy-remap', 'place-value'] as const;
export type AttributeMappingRuleKind = (typeof AttributeMappingRuleKindValues)[number];

/**
 * Product-metadata sources a `place-value` rule can read. Resolved by the
 * projection service from the metadata the caller threads in.
 */
export const PlaceValueSourceValues = [
  'name',
  'variant',
  'manufacturer',
  'ean',
  'sku',
  'weight',
] as const;
export type PlaceValueSource = (typeof PlaceValueSourceValues)[number];

/** A single source-to-destination value translation for a `copy-remap` rule. */
export interface AttributeRuleValueRemap {
  sourceValue: string;
  destinationValue: string;
}

/**
 * Kind-specific configuration, discriminated by `kind`. Stored as a jsonb blob on
 * the rule row (the scope + target live in real columns).
 */
export type AttributeMappingRuleConfig =
  | { kind: 'fixed'; value: string }
  | { kind: 'copy-remap'; sourceAttributeKey: string; valueRemap: AttributeRuleValueRemap[] }
  | { kind: 'place-value'; source: PlaceValueSource };

/**
 * Upsert input for an attribute mapping rule. `id` present ⇒ update that row;
 * absent ⇒ create. Scope fields are all optional (AND-combined); `null`/omitted
 * ⇒ the dimension is unscoped (matches any).
 */
export interface AttributeMappingRuleInput {
  id?: string;
  destinationParameterName: string;
  config: AttributeMappingRuleConfig;
  /** Lower runs first; later rule wins for the same destination parameter. */
  priority: number;
  sourceConnectionId?: string | null;
  destinationCategoryId?: string | null;
  /** Case-insensitive equality against the product manufacturer. */
  manufacturerMatch?: string | null;
  /** Case-insensitive substring of the product name. */
  phraseMatch?: string | null;
}
