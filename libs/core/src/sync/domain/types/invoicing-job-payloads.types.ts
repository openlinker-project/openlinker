/**
 * Invoicing Job Payload Types
 *
 * Canonical payload schemas for invoicing.* sync jobs (core-owned,
 * capability-scoped; executed by the worker).
 *
 * @module libs/core/src/sync/domain/types
 */

/**
 * Payload for `invoicing.regulatoryStatus.reconcile` (#1121). Carries only the
 * page size — there is NO cursor: the reconciliation frontier is a shrinking set
 * walked from offset 0 every run (plan decision #5).
 */
export interface RegulatoryStatusReconcilePayloadV1 {
  schemaVersion: 1;
  /** Page size: max number of non-terminal records to reconcile this run. */
  limit: number;
}
