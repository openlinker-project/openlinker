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
