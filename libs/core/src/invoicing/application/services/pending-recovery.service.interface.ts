/**
 * Pending Recovery Service Interface
 *
 * Contract for the crash-recovery sweep (#1703, mini-epic #1585, ADR-035): for
 * one connection, resolve `InvoiceRecord`s left non-terminal by a process that
 * died mid-issuance (`status='pending'` never claimed, or a stale `issuing` row
 * whose CAS lease lapsed past a safety margin). Because OL cannot know from its
 * own state whether the authority actually received the interrupted document, it
 * asks the authority via the `RegulatoryRecordLocator` sub-capability:
 *   - FOUND on the authority side -> reconcile the record to its true outcome
 *     (`status='issued'`, `regulatoryStatus='accepted'`, clearance reference set);
 *   - NOT FOUND (or the adapter has no locator) -> fiscal-safe: mark the record
 *     `status='failed'` with the in-doubt failure mode + an operator-visible
 *     alert; NEVER auto-retry (a silent re-issue could double-issue a fiscal
 *     document whose original attempt did land).
 * Per-record errors are counted and never rethrown - a transient authority
 * failure simply leaves the record for the next run.
 *
 * Paging is a `(updatedAt, id)` KEYSET CURSOR walked across pages WITHIN one run
 * (mirrors the offline-resubmit / reconcile sweeps): `limit` is the per-PAGE
 * size and the sweep pages forward - strictly after the last-seen
 * `(updatedAt, id)` - until the stuck frontier is drained, capping pages per run
 * as a runaway guard.
 *
 * @module libs/core/src/invoicing/application/services
 */

export interface PendingRecoveryOptions {
  /** Page size: max number of stuck records to recover this run. */
  limit: number;
}

export interface PendingRecoveryResult {
  /** Records read + attempted this run. */
  scanned: number;
  /** Records reconciled to `issued`/`accepted` (found on the authority side). */
  recovered: number;
  /** Records marked `failed` in-doubt (not found / no locator) for manual review. */
  markedInDoubt: number;
  /** Records whose recovery threw (counted, sweep continued, left for the next run). */
  errors: number;
  /** Total stuck records matching the query (for coverage logging). */
  total: number;
}

export interface IPendingRecoveryService {
  /**
   * Recover the connection's stuck-pending invoice records. Idempotent and safe
   * to re-run: a record whose authority is transiently unreachable stays stuck
   * for the next run; a resolved record is terminal and no longer selected.
   */
  recover(connectionId: string, opts: PendingRecoveryOptions): Promise<PendingRecoveryResult>;
}
