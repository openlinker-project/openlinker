/**
 * Mirakl Catalogue Types
 *
 * Wire shapes of the catalogue endpoints #4278 reads, as Empik staging
 * returns them (SPIKE-4268):
 *
 * - H11 `GET /api/hierarchies`: the category tree. `max_level` counts levels
 *   below `hierarchy`, and the node's ancestors come back too.
 * - PM11 `GET /api/products/attributes`: card attributes for a category.
 * - VL11 `GET /api/values_lists`: the values of a LIST attribute.
 * - P31 `GET /api/products`: catalogue cards by reference (EAN).
 *
 * @module libs/integrations/mirakl/src/domain/types
 */

export interface MiraklHierarchy {
  readonly code?: string;
  readonly label?: string;
  readonly level?: number;
  /** `''` for a root. */
  readonly parent_code?: string;
}

export interface MiraklProductAttribute {
  readonly code?: string;
  readonly label?: string;
  /** `''` for an attribute every category has. */
  readonly hierarchy_code?: string;
  readonly required?: boolean;
  /** `TEXT`, `LONG_TEXT`, `INTEGER`, `DECIMAL`, `LIST`, `LIST_MULTIPLE_VALUES`, `MEDIA`, `LINK`, `DATE`, ... */
  readonly type?: string;
  readonly type_parameter?: string | null;
  /** The VL11 list code for a LIST attribute. */
  readonly values_list?: string | null;
  readonly description?: string | null;
  /** Whether the attribute tells variants of one card apart. */
  readonly variant?: boolean;
}

export interface MiraklValueListEntry {
  readonly code?: string;
  readonly label?: string;
}

export interface MiraklValueList {
  readonly code?: string;
  readonly label?: string | null;
  readonly values?: readonly MiraklValueListEntry[];
}

/** One catalogue card as P31 returns it. */
export interface MiraklCatalogCard {
  readonly product_id?: string;
  readonly product_id_type?: string;
  /** The operator's card id. */
  readonly product_sku?: string;
  readonly product_title?: string;
  readonly category_code?: string;
  readonly category_label?: string;
}
