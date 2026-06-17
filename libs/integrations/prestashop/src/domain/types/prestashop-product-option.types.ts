/**
 * PrestaShop Product Option Types (#1050)
 *
 * Response shapes for the `/product_options` (attribute groups, e.g. "Color")
 * and `/product_option_values` (values, e.g. "Red") WS list endpoints, used by
 * `PrestashopAttributeResolver` to turn a combination's positional
 * `product_option_value` id-refs into semantic `{ attributeGroupName: valueName }`
 * variant attributes. Only the fields the resolver consumes are typed; PS WS
 * returns more.
 *
 * `name` is a PrestaShop localized field (flat string, JSON `[{id,value}]`, or
 * XML `{language:[…]}`) — read via the product mapper's `localizeField`.
 *
 * @module libs/integrations/prestashop/src/domain/types
 */

/** `GET /product_options` row — an attribute group (e.g. "Color"). */
export interface PrestashopProductOption {
  id: string | number;
  name?: unknown;
}

/** `GET /product_option_values` row — a value (e.g. "Red") + its owning group. */
export interface PrestashopProductOptionValue {
  id: string | number;
  name?: unknown;
  id_attribute_group?: string | number;
}

/** A `product_option_value` id resolved to its semantic group + value names. */
export interface ResolvedOptionValue {
  /** Attribute group name (e.g. "Color"). */
  groupName: string;
  /** Value name within the group (e.g. "Red"). */
  valueName: string;
}

/**
 * Resolves a combination's `product_option_value` id to its
 * {@link ResolvedOptionValue}, or `null` when unknown. Passed into `mapVariant`
 * so the mapper stays I/O-free.
 */
export type OptionValueResolver = (optionValueId: string) => ResolvedOptionValue | null;

/**
 * Reads a PrestaShop localized field into a single string for a language. The
 * attribute resolver receives the product mapper's `localizeField` as this type
 * so it reuses the one parser rather than re-implementing PS's field shapes.
 */
export type LocalizeFn = (field: unknown, langId?: number) => string | undefined;

/** `GET /product_features` row — a feature group (e.g. "Material") (#1096 F2). */
export interface PrestashopProductFeature {
  id: string | number;
  name?: unknown;
}

/** `GET /product_feature_values` row — a value (e.g. "Ceramic") + its owning feature. */
export interface PrestashopProductFeatureValue {
  id: string | number;
  value?: unknown;
  id_feature?: string | number;
}

/** A `{ featureId, featureValueId }` pair resolved to its `{ name, value }` (#1096 F2). */
export interface ResolvedFeature {
  /** Feature group name (e.g. "Material"). */
  name: string;
  /** Value within the group (e.g. "Ceramic"). */
  value: string;
}
