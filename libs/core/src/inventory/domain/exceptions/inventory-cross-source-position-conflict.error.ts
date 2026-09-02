/**
 * Inventory Cross-Source Position Conflict Error
 *
 * Raised when a second `InventoryMaster` connection tries to INSERT its own row
 * for a position an existing row already occupies at a NON-NULL `locationId`,
 * and one of the two partial unique indexes on `inventory_items` refuses it
 * (#2320).
 *
 * ## Why this became reachable
 *
 * Before #2320, `findByProductAndVariant` ignored provenance, so connection B
 * matched connection A's row and took the UPDATE branch — clobbering A's
 * quantities and provenance rather than colliding. That silent clobber is the
 * defect ADR-058 decision (4) closes; scoping the lookup means B now correctly
 * concludes it has no row of its own and attempts an INSERT. Where `locationId`
 * is NULL the insert succeeds (the indexes are NULL-distinct, the pre-existing
 * hole #2325 closes), and cross-source coexistence works as ADR-058 decision (2)
 * intends. Where `locationId` is NON-NULL the index has no NULL to be distinct
 * about and the insert is rejected.
 *
 * ## Why a typed error rather than the raw driver failure
 *
 * The condition is PERMANENT: neither connection will stop claiming the
 * position, so every retry re-runs the identical INSERT and fails identically.
 * Letting the `QueryFailedError` propagate would burn the job runner's full
 * retry ladder on a state no retry can change, and would surface to an operator
 * as an opaque constraint name. Naming it lets the caller classify it and lets
 * the greppable `inventory_cross_source_position_conflict` log line lead
 * straight here.
 *
 * ## The fix is #2325, not a workaround here
 *
 * The real repair is ADR-058 ladder step (iii): recreating the unique indexes
 * over the FOUR-column position key (`productId`, `productVariantId`,
 * `locationId`, `sourceConnectionId`), at which point both rows are legal and
 * this error becomes unreachable. Nothing here should route around the
 * constraint in the meantime — falling back to an UPDATE would reinstate
 * exactly the cross-source clobber this slice removed.
 *
 * @module libs/core/src/inventory/domain/exceptions
 */
export class InventoryCrossSourcePositionConflictError extends Error {
  constructor(
    public readonly productId: string,
    public readonly productVariantId: string | null,
    public readonly locationId: string | null,
    public readonly sourceConnectionId: string | null
  ) {
    super(
      `Inventory position is already held by another source at this location; ` +
        `the four-column unique index (#2325) is required before both can coexist ` +
        `(productId=${productId}, productVariantId=${productVariantId ?? 'null'}, ` +
        `locationId=${locationId ?? 'null'}, sourceConnectionId=${sourceConnectionId ?? 'null'})`
    );
    this.name = 'InventoryCrossSourcePositionConflictError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InventoryCrossSourcePositionConflictError);
    }
  }
}
