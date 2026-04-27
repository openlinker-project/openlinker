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
 * @module libs/core/src/listings/domain/types
 */

export const CategoryParameterTypeValues = [
  'dictionary',
  'string',
  'integer',
  'float',
] as const;
export type CategoryParameterType = (typeof CategoryParameterTypeValues)[number];

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
  /** Optional unit label (e.g. "mm", "kg"). */
  unit?: string;
  /** Present when type === 'dictionary'. Entries may carry their own `dependsOnParameterValueIds`. */
  dictionary?: CategoryParameterDictionaryEntry[];
  restrictions: CategoryParameterRestrictions;
  /** Parameter-level visibility (show/hide). Distinct from per-entry filtering. */
  dependsOn?: CategoryParameterDependsOn;
}
