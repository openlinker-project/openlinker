/**
 * Inventory Location Domain Entity
 *
 * An operator-authored place stock can sit — the first-class row ADR-058
 * decision (1) makes `inventory_items.locationId` point at, replacing a bare
 * nullable string that referenced nothing.
 *
 * **`ownerConnectionId` is provenance, never authority.** It records whose sync
 * may write positions here — i.e. where the rows at this location came from. It
 * confers no right to decide anything about them: authority over a position is
 * a separate, independently assignable concern (ADR-052), and reading this field
 * as "the connection that controls this location" would collapse the two. It is
 * nullable because an operator's own warehouse has no originating connection at
 * all, and it is cleared rather than cascaded when a connection is deleted — an
 * operator's warehouse must outlive the integration that happened to stock it.
 *
 * Note what a location is NOT: `locationId IS NULL` on a position permanently
 * means "the master declines to locate its stock" (ADR-058 decision 2), never
 * "the default location". No row here is ever a stand-in for that NULL.
 *
 * Anemic and readonly per ADR-011 — state changes go through the repository.
 * `LocationNetwork` (grouping locations into routable networks) is deferred to
 * v3 and deliberately has no field here.
 *
 * @module libs/core/src/inventory/domain/entities
 */
import type {
  InventoryLocationKind,
  InventoryLocationStatus,
} from '../types/location.types';

export class InventoryLocation {
  constructor(
    /** OL-owned `ol_location_*` id. A location has no external counterpart. */
    public readonly id: string,
    /** Operator-facing natural key, unique across the install. */
    public readonly code: string,
    public readonly name: string,
    public readonly kind: InventoryLocationKind,
    /** Provenance, never authority — see the class docblock. */
    public readonly ownerConnectionId: string | null,
    /** Free-text operator reference. NOT an identifier mapping. */
    public readonly externalRef: string | null,
    public readonly status: InventoryLocationStatus,
    public readonly countryIso2: string | null,
    public readonly postcode: string | null,
    public readonly latitude: number | null,
    public readonly longitude: number | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date
  ) {}
}
