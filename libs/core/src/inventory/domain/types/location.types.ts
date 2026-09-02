/**
 * Inventory Location Types
 *
 * Vocabulary for the operator-authored inventory locations introduced by
 * ADR-058 decision (1). Locations are first-class rows rather than the bare
 * nullable `inventory_items.locationId` string they used to point at.
 *
 * `countryIso2` / `postcode` / geo are present from day one deliberately: the
 * fulfillment router's filters are unimplementable without them, and the table
 * is cheapest to get right while it is new (ADR-058 R1 / REVIEW §3 D3).
 *
 * @module libs/core/src/inventory/domain/types
 */
import type { InventoryLocation } from '../entities/inventory-location.entity';

/**
 * What a location physically is. Operator-declared, not derived — OL never
 * infers a kind from a connection's platform type.
 */
export const InventoryLocationKindValues = [
  'warehouse',
  'store',
  'third-party',
  'virtual',
] as const;

export type InventoryLocationKind = (typeof InventoryLocationKindValues)[number];

/**
 * Whether the location participates in routing/availability today.
 *
 * `inactive` is a soft retirement: existing positions keep pointing at it, so a
 * historical row never dangles. Deletion is a separate, refused-when-referenced
 * operation (#2316).
 */
export const InventoryLocationStatusValues = ['active', 'inactive'] as const;

export type InventoryLocationStatus = (typeof InventoryLocationStatusValues)[number];

/**
 * Fields an operator supplies when creating a location.
 *
 * `code` is normalised in exactly one place (the application service) so the
 * case-sensitive unique index cannot be bypassed by a caller that skips it.
 */
export interface CreateInventoryLocationInput {
  code: string;
  name: string;
  kind: InventoryLocationKind;
  /** Provenance only — see the entity docblock. Never authority. */
  ownerConnectionId?: string | null;
  externalRef?: string | null;
  status?: InventoryLocationStatus;
  countryIso2?: string | null;
  postcode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Partial update. Every field is optional; an omitted field is left untouched,
 * while an explicit `null` clears a nullable column.
 *
 * `code` is deliberately absent: it is the row's operator-facing natural key and
 * is referenced by `inventory_items.locationId` semantics, so renaming it is not
 * a patch-shaped operation.
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
 * List filters. All optional and AND-combined; an absent field does not filter.
 */
export interface InventoryLocationFilters {
  kind?: InventoryLocationKind;
  status?: InventoryLocationStatus;
  countryIso2?: string;
  /** Case-insensitive prefix match on `code`. */
  codePrefix?: string;
}

export interface InventoryLocationPagination {
  page: number;
  limit: number;
}

export interface PaginatedInventoryLocations {
  items: InventoryLocation[];
  total: number;
  page: number;
  limit: number;
}
