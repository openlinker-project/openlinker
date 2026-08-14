/**
 * Destination Category Domain Entity (#1979, ADR-037)
 *
 * One node of a destination's category tree, projected into OpenLinker's own
 * store so reads never round-trip the platform. Keyed by `taxonomyOwner` for a
 * marketplace (one shared tree, stored once no matter how many connections read
 * it) or by `connectionId` for a shop (which authors its own categories).
 *
 * Anemic and readonly per ADR-011 — disappearance is recorded by the `syncedAt`
 * watermark sweep in the repository, never by a mutation here.
 *
 * @module libs/core/src/listings/domain/entities
 * @see {@link TaxonomyScope} for the exactly-one-of keying invariant
 */
import type { TaxonomyOwner } from '../types/taxonomy-owner.types';

export class DestinationCategory {
  constructor(
    /** Non-null for a marketplace tree; `null` for a shop-owned one. */
    public readonly taxonomyOwner: TaxonomyOwner | null,
    /** Non-null for a shop-owned tree; `null` for a marketplace one. */
    public readonly connectionId: string | null,
    /** Destination-native category id (an Allegro category id, a WC term id). */
    public readonly externalId: string,
    public readonly name: string,
    /** Parent category id, or `null` for a root-level node. */
    public readonly parentId: string | null,
    /** `null` for a shop node — a shop accepts a product in any node (ADR-024). */
    public readonly leaf: boolean | null,
    /** Stamped by the run that last observed this node. */
    public readonly syncedAt: Date,
  ) {}
}
