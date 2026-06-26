/**
 * Regulatory Status Reconciliation Service Interface
 *
 * Contract for the KSeF regulatory-status reconciliation sweep (#1121): for one
 * connection, refresh `InvoiceRecord.regulatoryStatus` / `clearanceReference` of
 * `issued` records whose regulatory status is still NON-terminal by reading
 * authoritative status via the `RegulatoryStatusReader` sub-capability. The read
 * is authoritative; terminal reads are written back so the record drops out of
 * the next sweep. Receipts / `not-applicable` are never polled (excluded by the
 * repository query).
 *
 * Paging is a `(updatedAt, id)` KEYSET CURSOR walked across pages WITHIN one run
 * (plan decision #5, revised on #1206): `limit` is the per-PAGE size and the
 * sweep pages forward — strictly after the last-seen `(updatedAt, id)` — until
 * the frontier is drained. The cursor advances on every scanned row regardless
 * of whether it was written, so the WHOLE non-terminal frontier is visited each
 * run even when the oldest rows are perpetually unchanged (a no-op read does NOT
 * bump `updatedAt`) and `total > limit`. Skip-free and starvation-free; the
 * cursor is intra-run and unrelated to the exactly-once issuance key.
 *
 * @module libs/core/src/invoicing/application/services
 */

export interface RegulatoryStatusReconcileOptions {
  /** Page size: max number of non-terminal records to reconcile this run. */
  limit: number;
}

export interface RegulatoryStatusReconcileResult {
  /** Records read this run. */
  scanned: number;
  /** Records whose projection was updated (status and/or clearanceReference). */
  updated: number;
  /** Records skipped because the RECORD was already terminal (race guard). */
  skippedTerminal: number;
  /** Records whose authoritative read threw (counted, sweep continued). */
  readErrors: number;
  /** Total non-terminal records matching the query (for coverage logging). */
  total: number;
}

export interface IRegulatoryStatusReconciliationService {
  /**
   * Reconcile one page of the connection's issued + non-terminal invoice
   * records. Connections whose adapter does not implement
   * `RegulatoryStatusReader` are skipped with a zeroed result (no throw).
   * Idempotent and safe to re-run: no upstream change yields a clean no-op.
   */
  reconcile(
    connectionId: string,
    opts: RegulatoryStatusReconcileOptions,
  ): Promise<RegulatoryStatusReconcileResult>;
}
