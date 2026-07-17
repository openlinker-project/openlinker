/**
 * Offline Resubmission Service Interface
 *
 * Contract for the degraded-mode offline-resubmission sweep (#1702, mini-epic
 * #1585, ADR-035): for one connection, retransmit `InvoiceRecord`s stuck in the
 * neutral `pending-submission` state - documents issued with legal effect while
 * the clearance authority was unreachable - by calling the `OfflineResubmitter`
 * sub-capability once the authority recovers, then persist the resulting
 * `regulatoryStatus` / `providerInvoiceId` / `clearanceReference`. Connections
 * whose adapter does not implement `OfflineResubmitter` are skipped with a zeroed
 * result (no throw). Per-record errors are counted and never rethrown - a
 * still-unavailable authority simply leaves the record for the next run.
 *
 * Paging is a `(updatedAt, id)` KEYSET CURSOR walked across pages WITHIN one run
 * (mirrors the reconcile sweep): `limit` is the per-PAGE size and the sweep pages
 * forward - strictly after the last-seen `(updatedAt, id)` - until the frontier
 * is drained, capping pages per run as a runaway guard.
 *
 * @module libs/core/src/invoicing/application/services
 */

export interface OfflineResubmissionOptions {
  /** Page size: max number of `pending-submission` records to resubmit this run. */
  limit: number;
  /**
   * How long (ms) a `pending-submission` record must age since its last touch
   * before this sweep considers it (#1585 F4). Guards the confirm-non-receipt
   * gate: a document that LANDED just before its response timed out needs time to
   * surface in the authority's eventually-consistent metadata index before a
   * `null` locate is trusted as a genuine non-receipt. Because the offline window
   * is entered precisely when the authority was unavailable, index recovery can
   * lag by tens of minutes; this is deliberately much larger than the CAS lease
   * and is host-tunable. Falls back to
   * {@link OFFLINE_RESUBMIT_SETTLING_MARGIN_MS} when omitted.
   */
  settlingMarginMs?: number;
}

export interface OfflineResubmissionResult {
  /** Records read + attempted this run. */
  scanned: number;
  /** Records whose projection advanced (status / providerInvoiceId / clearanceReference). */
  updated: number;
  /** Records whose resubmit threw (counted, sweep continued, left for the next run). */
  resubmitErrors: number;
  /** Total `pending-submission` records matching the query (for coverage logging). */
  total: number;
}

export interface IOfflineResubmissionService {
  /**
   * Resubmit the connection's `pending-submission` invoice records. Connections
   * whose adapter does not implement `OfflineResubmitter` are skipped with a
   * zeroed result (no throw). Idempotent and safe to re-run: a record whose
   * authority is still unreachable stays `pending-submission` for the next run.
   */
  resubmit(
    connectionId: string,
    opts: OfflineResubmissionOptions,
  ): Promise<OfflineResubmissionResult>;
}
