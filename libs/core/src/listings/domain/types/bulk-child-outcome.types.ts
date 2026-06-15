/**
 * Bulk Child Outcome Types (#737)
 *
 * The terminal outcome a single child of a `BulkListingBatch` reports
 * back to the parent batch via `IBulkListingProgressService.advanceBatchStatus`.
 * Maps the V2 sync-job's `JobOutcome` (`'ok' | 'business_failure'`) onto the
 * batch-counter axis (`succeeded` / `failed`) — the handler does that mapping
 * once at the call site.
 *
 * `as const` + union pattern per `engineering-standards.md § Union Types`.
 * Runtime array enables exhaustiveness checks and future Swagger surfacing.
 *
 * @module libs/core/src/listings/domain/types
 */

export const BulkChildOutcomeValues = ['succeeded', 'failed'] as const;
export type BulkChildOutcome = (typeof BulkChildOutcomeValues)[number];
