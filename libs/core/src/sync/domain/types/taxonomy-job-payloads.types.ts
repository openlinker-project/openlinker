/**
 * Taxonomy Sync Job Payloads (#1979, ADR-037)
 *
 * @module libs/core/src/sync/domain/types
 */

/**
 * Payload for `destination.taxonomy.sync`.
 *
 * INTERIM SHAPE (ADR-037 § Sequencing). The job's real subject is a taxonomy
 * OWNER, not a connection — one run writes one row set that every borrowing
 * connection reads. But `SyncJob.connectionId` is non-nullable and every other
 * job type is connection-scoped, so the job stays connection-scoped with the
 * owner carried here, and "one run per owner" is enforced by the scheduler's
 * idempotency key instead of by the column.
 *
 * The ROWS are owner-keyed regardless, so nothing in the read model depends on
 * this. The live cost is false provenance in the dead-job cockpit: the run is
 * filed under whichever seller connection sourced it. Removal is tracked as
 * **#1943** (`SyncJob.connectionId` nullability) — do not let it drift.
 */
export interface DestinationTaxonomySyncPayloadV1 {
  schemaVersion: 1;
  /** `null` for a shop, whose taxonomy is keyed by the connection itself. */
  taxonomyOwner: string | null;
  /** Max parent levels expanded per run; bounds a large first sync. */
  pageLimit?: number;
}
