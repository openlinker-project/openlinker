/**
 * Inventory Location Types (frontend view of the #2313 / #2316 / #2407 wire contract)
 *
 * The browser bundle cannot depend on `@openlinker/core` (#591), so these are
 * copies of the API's response shapes rather than imports.
 *
 * @module apps/web/src/features/inventory/api
 */

/** What a location physically is (#2316). Operator-declared, never derived. */
export const InventoryLocationKindValues = ['warehouse', 'store', 'third-party', 'virtual'] as const;
export type InventoryLocationKind = (typeof InventoryLocationKindValues)[number];

/**
 * Whether the location participates in routing/availability today.
 * `inactive` is a soft retirement, not a delete — see `deleteLocation`.
 */
export const InventoryLocationStatusValues = ['active', 'inactive'] as const;
export type InventoryLocationStatus = (typeof InventoryLocationStatusValues)[number];

/**
 * The full row — mirrors `LocationResponseDto` field-for-field (#3064).
 * `InventoryLocationSummary` below stays the minimal shape the #2407
 * readiness/bootstrap surfaces already read; this is its superset, so an
 * `InventoryLocation` satisfies every existing `InventoryLocationSummary`
 * consumer without a second type walking the same fields.
 */
export interface InventoryLocation {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: InventoryLocationKind;
  /** Provenance only — whose sync may write positions here. Never authority (ADR-052). */
  readonly ownerConnectionId: string | null;
  /** Free-text operator reference. NOT an identifier mapping. */
  readonly externalRef: string | null;
  readonly status: InventoryLocationStatus;
  /** ISO-3166-1 alpha-2. */
  readonly countryIso2: string | null;
  readonly postcode: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** ISO-8601 */
  readonly createdAt: string;
  /** ISO-8601 */
  readonly updatedAt: string;
}

export interface InventoryLocationSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

/** All optional and AND-combined; an absent field does not filter. */
export interface InventoryLocationFilters {
  kind?: InventoryLocationKind;
  /** Omitted lists every status, including `inactive` — soft retirement stays visible. */
  status?: InventoryLocationStatus;
  /** ISO-3166-1 alpha-2. Matched case-insensitively (uppercased before the request). */
  countryIso2?: string;
  /** Case-insensitive prefix match on `code`. */
  codePrefix?: string;
}

/**
 * 1-based `page`/`limit`, unlike `InventoryPagination`'s `limit`/`offset` —
 * the divergence mirrors `ListLocationsQueryDto`'s own docblock: this is the
 * core `InventoryLocationPagination` contract, echoed verbatim.
 */
export interface InventoryLocationListPagination {
  page?: number;
  limit?: number;
}

/** The paged listing. Widened from summaries to full rows for #3064's `listLocations`. */
export interface PaginatedInventoryLocations {
  readonly items: readonly InventoryLocation[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

/** Mirrors `CreateLocationDto` field-for-field (#3064). */
export interface CreateInventoryLocationInput {
  code: string;
  name: string;
  kind: InventoryLocationKind;
  ownerConnectionId?: string | null;
  externalRef?: string | null;
  status?: InventoryLocationStatus;
  countryIso2?: string | null;
  postcode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Mirrors `UpdateLocationDto` field-for-field (#3064). Every field optional;
 * an omitted field is left untouched, an explicit `null` clears a nullable
 * column. `code` is deliberately absent — it is the row's natural key.
 */
export interface UpdateInventoryLocationInput {
  name?: string;
  kind?: InventoryLocationKind;
  ownerConnectionId?: string | null;
  externalRef?: string | null;
  status?: InventoryLocationStatus;
  countryIso2?: string | null;
  postcode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
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
