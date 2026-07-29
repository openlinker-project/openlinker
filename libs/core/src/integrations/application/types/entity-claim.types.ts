/**
 * Entity Claim Types
 *
 * Input shape for the entity-claim lookup: "which connections other than the
 * reporting one also claim this internal entity id, and hold the capability
 * that would let them write it?" (#1904).
 *
 * @module libs/core/src/integrations/application/types
 */

export interface EntityClaimQuery {
  /** Mapped entity type, e.g. `CORE_ENTITY_TYPE.Product`. */
  entityType: string;
  /** Internal OpenLinker id whose claimants are being resolved. */
  internalId: string;
  /**
   * Capability a rival claimant must have enabled to count, e.g.
   * `'ProductMaster'` / `'InventoryMaster'`. Narrows the result to connections
   * that could actually be writing this entity, so an unrelated mapping never
   * counts as a rival.
   */
  capability: string;
  /** The reporting connection - always excluded from the result. */
  excludeConnectionId: string;
}
