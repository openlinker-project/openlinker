/**
 * Pending Recovery Service Interface
 *
 * Contract for the crash-recovery sweep (#1703, mini-epic #1585, ADR-035): for
 * one connection, resolve `InvoiceRecord`s left non-terminal by a process that
 * died mid-issuance. The two stuck shapes are NOT fiscally equivalent (#1585 I3):
 *   - `status='pending'` (NEVER CLAIMED -> never transmitted): re-driven by
 *     requeuing the original `invoicing.issue` job (safe; the `issued`-only
 *     exactly-once gate makes the re-run a no-op if a document somehow exists).
 *     NEVER marked in-doubt (that would strand the order AND block `claimForIssue`).
 *   - `status='issuing'` (CRASHED POST-CLAIM -> may have landed): because OL
 *     cannot know from its own state whether the authority received it, it asks
 *     the authority via the `RegulatoryRecordLocator` sub-capability:
 *       - FOUND -> reconcile to its located outcome (`status='issued'` for a
 *         non-rejected result, clearance reference set);
 *       - NOT FOUND (or the adapter has no locator) -> fiscal-safe: mark the
 *         record `status='failed'` with the in-doubt failure mode + an
 *         operator-visible alert; NEVER auto-retry (a silent re-issue could
 *         double-issue a fiscal document whose original attempt did land).
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
  /** `issuing` records reconciled to their located outcome (found on the authority side). */
  recovered: number;
  /**
   * Never-claimed `pending` records re-driven by requeuing their dead
   * `invoicing.issue` job (#1585 I3) - nothing was transmitted, so re-driving is
   * safe and preferred over marking in-doubt.
   */
  reissued: number;
  /** `issuing` records marked `failed` in-doubt (not found / no locator) for manual review. */
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
