/**
 * Category Parameter Types
 *
 * Marketplace-neutral shape for marketplace-category parameters (Allegro
 * "category required parameters", eBay "Item Specifics" / "aspects",
 * Amazon "Product Type Definitions"). The 4 base types
 * (dictionary | string | integer | float) and the restriction flags
 * generalize across platforms.
 *
 * Allegro distinguishes two independent dependency mechanisms; both are
 * surfaced separately:
 *   - parameter-level visibility (`parameter.dependsOn`) — the parameter
 *     shows / hides based on a parent parameter's value.
 *   - dictionary-entry filtering (`dictionary[i].dependsOnParameterValueIds`)
 *     — within a visible dictionary parameter, individual entries appear /
 *     disappear based on a parent's value.
 *
 * Conflating them would mis-render both classes of category — see issue #410
 * for context.
 *
 * Scope note (#1035, ADR-023 §6): this shape captures a destination's
 * *flattened, top-level* required parameters. Amazon's Product-Type
 * JSON-Schema conditional / nested requirements are out of scope — they don't
 * fit a flat list and are intentionally not represented here.
 *
 * @module libs/core/src/listings/domain/types
 */

export const CategoryParameterTypeValues = [
  'dictionary',
  'string',
  'integer',
  'float',
] as const;
export type CategoryParameterType = (typeof CategoryParameterTypeValues)[number];

/**
 * Where the parameter must travel on the wire when creating an offer (#415).
 *
 *   - `'offer'`   — goes under `body.parameters[]` (free-text fields, condition,
 *                   EAN, etc.). The default for marketplaces that don't
 *                   distinguish a separate product layer.
 *   - `'product'` — goes under `body.product.parameters[]` (Brand, Model,
 *                   Manufacturer-code, etc., on Allegro). Sending a
 *                   product-section parameter under `body.parameters` triggers
 *                   `ParameterCategoryException` 422.
 *
 * Allegro derives this from `options.describesProduct: boolean` on each
 * parameter in `GET /sale/categories/{id}/parameters`. Adapters that cannot
 * distinguish (eBay, Shopify, …) emit `'offer'` for every parameter.
 */
export const CategoryParameterSectionValues = ['offer', 'product'] as const;
export type CategoryParameterSection = (typeof CategoryParameterSectionValues)[number];

export interface CategoryParameterDictionaryEntry {
  id: string;
  value: string;
  /**
   * Entry-level dependency (Allegro's exact field name). When non-empty, this
   * entry is selectable only when the parent parameter (identified by
   * `parameter.dependsOn?.parameterId`, if any) has one of these value IDs.
   * Independent from parameter-level visibility — a parameter can be visible
   * while only a subset of its dictionary entries is selectable for a given
   * parent value.
   */
  dependsOnValueIds?: string[];
}

export interface CategoryParameterRestrictions {
  /** Dictionary multi-select. */
  multipleChoices?: boolean;
  /** Numeric range — user supplies { from, to } instead of single value. */
  range?: boolean;
  /** Numeric bounds. */
  min?: number;
  max?: number;
  /** String length bounds. */
  minLength?: number;
  maxLength?: number;
  /** Float decimal precision. */
  precision?: number;
  /**
   * Maximum number of values the user may submit for this parameter.
   * `1` = single-value, `2+` = bounded multi-value (e.g. `5` for short text-tag
   * lists, `20` for keyword fields). Allegro-derived but generic.
   */
  allowedNumberOfValues?: number;
  /** Dictionary allows free-text values alongside the dictionary list (combobox). */
  customValuesEnabled?: boolean;
}

/**
 * Parameter-level visibility dependency. The parameter is hidden until
 * the parent has one of these values. Used for true show/hide semantics —
 * NOT for filtering dictionary entries within an already-visible parameter.
 */
export interface CategoryParameterDependsOn {
  parameterId: string;
  valueIds: string[];
}

export interface CategoryParameter {
  id: string;
  name: string;
  type: CategoryParameterType;
  required: boolean;
  /**
   * Neutral multi-value cardinality roll-up (#1035, ADR-023 §6): `true` when the
   * parameter accepts more than one value — eBay `itemToAspectCardinality: MULTI`,
   * Allegro `restrictions.multipleChoices` or `allowedNumberOfValues > 1`. A
   * convenience flag so cross-platform consumers (e.g. attribute projection)
   * needn't decode each platform's `restrictions` shape; `restrictions` still
   * carries the platform-precise counts. `undefined` ⇒ single-valued. Optional
   * for now (additive); adapters that can express it SHOULD set it explicitly —
   * promote to required once a second producing adapter lands.
   */
  multiValue?: boolean;
  /** Optional unit label (e.g. "mm", "kg"). */
  unit?: string;
  /** Present when type === 'dictionary'. Entries may carry their own `dependsOnParameterValueIds`. */
  dictionary?: CategoryParameterDictionaryEntry[];
  restrictions: CategoryParameterRestrictions;
  /** Parameter-level visibility (show/hide). Distinct from per-entry filtering. */
  dependsOn?: CategoryParameterDependsOn;
  /**
   * Wire-shape section the parameter belongs to (#415). Required —
   * adapters that can't distinguish must emit `'offer'` explicitly so
   * future adapters can't silently inherit a default.
   */
  section: CategoryParameterSection;
}
