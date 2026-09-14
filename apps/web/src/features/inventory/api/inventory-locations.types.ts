/**
 * Inventory Location Types (frontend view of the #2313 / #2407 wire contract)
 *
 * The browser bundle cannot depend on `@openlinker/core` (#591), so these are
 * copies of the API's response shapes rather than imports.
 *
 * @module apps/web/src/features/inventory/api
 */

export interface InventoryLocationSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

/**
 * Filters the locations listing accepts (#3060).
 *
 * A deliberate SUBSET: only the axis this stack reads. #3198 (the locations
 * CRUD screen) widens it with `kind` / `countryIso2` / `codePrefix` under the
 * same names, so the two converge rather than compete.
 */
export interface InventoryLocationFilters {
  /** Omitted lists every status, including `inactive` — retirement stays visible. */
  status?: string;
}

/**
 * 1-based `page`/`limit`, unlike `InventoryPagination`'s `limit`/`offset` — the
 * divergence echoes `ListLocationsQueryDto`'s own contract rather than
 * normalising it here.
 */
export interface InventoryLocationListPagination {
  page?: number;
  limit?: number;
}

/** The paged listing, of which only `total` is read by the readiness surface. */
export interface PaginatedInventoryLocations {
  readonly items: readonly InventoryLocationSummary[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

/**
 * What a first-run bootstrap did (#2407).
 *
 * `existingCodes` is what makes a re-run visibly a no-op rather than an
 * indistinguishable success — `created: []` alone reads the same as a failure
 * that wrote nothing.
 */
export interface LocationBootstrapResult {
  readonly created: readonly InventoryLocationSummary[];
  readonly existingCodes: readonly string[];
}
