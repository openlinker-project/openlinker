/**
 * Inventory Job Payload Types
 *
 * Canonical payload schemas for the core-owned `inventory.*` sync jobs — passes
 * that operate on OpenLinker's own tables and make no platform calls at all.
 * Kept out of `master-job-payloads.types.ts` deliberately: that file's subject
 * is the `master.*` family, whose jobs are defined by talking to a master
 * system, and this one talks to nobody.
 *
 * @module libs/core/src/sync/domain/types
 */

/**
 * Connection-provenance backfill (#2317, ADR-058 ladder step (ii)).
 *
 * `pageLimit` bounds how many ROWS one run may stamp — not how many children it
 * enqueues, because this pass enqueues none; it does the work itself in a single
 * bounded UPDATE. Optional: omitting it takes the handler's own default, which
 * is deliberately larger than the sweep family's child-job default for exactly
 * that reason. The handler floors and clamps whatever arrives.
 *
 * There is no offset and no cycle id, and that absence is the design (see
 * `InventoryProvenanceBackfillHandler`): the predicate `sourceConnectionId IS
 * NULL` is self-consuming, so remaining work is re-derived from the table on
 * every tick rather than tracked on a cursor.
 */
export interface InventoryProvenanceBackfillPayloadV1 {
  schemaVersion: 1;
  pageLimit?: number;
}

/**
 * Lower one routed work's sold quantities in each line's owning product master
 * (#3453, `realtime` lane).
 *
 * Carries a REFERENCE and nothing else. The lines are read from the work row and
 * the order from OpenLinker's own store at execution time, so a retry acts on
 * what the work actually holds rather than on a snapshot in the payload.
 * `orderId` is used only to load the order; the work row stays the authority on
 * which order it belongs to.
 */
export interface InventorySaleDecrementPayloadV1 {
  readonly schemaVersion: 1;
  readonly workId: string;
  readonly orderId: string;
}
