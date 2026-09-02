/**
 * Return Status Sync Service Interface
 *
 * Pass 2 of returns ingestion (#2330): the bounded re-read of OL's own
 * non-terminal returns. Mirrors `IShipmentStatusSyncService` / the offer-status
 * sweep in shape — `{limit, offset}` in, `nextOffset` out, the handler owns the
 * cursor — because it is the same problem: no change feed exists, so OL must
 * re-read, and re-reading everything every run is not an option.
 *
 * @module libs/core/src/returns/application/services
 */

export interface ReturnStatusSyncOptions {
  /** Page size. */
  limit: number;
  /** Persisted scan offset (default 0). */
  offset?: number;
  /**
   * Age bound in days. Only returns opened within this window are candidates —
   * see `ReturnSourceSweepFilter.openedSince` for why this is not optional in
   * effect.
   */
  lookbackDays?: number;
}

export interface ReturnStatusSyncResult {
  /** Returns visited this run (== page size, or fewer at the tail). */
  scanned: number;
  /** Returns whose observation was persisted. */
  updated: number;
  /**
   * Re-reads this run that resolved the source order to an OL one.
   *
   * Real, not inferred: this sweep upserts inline, so unlike the discovery pass
   * it genuinely knows the answer for every row it touched. Note it counts
   * per-CALL attribution — a return already attributed by an earlier write stays
   * attributed even if this call could not re-resolve it, so this is
   * "resolutions this run", never "attributed returns".
   */
  attributed: number;
  /**
   * Re-reads this run that could NOT name the order. See `attributed` for why
   * this is not the same as the connection's orphan count; the orphan bucket
   * (`IReturnsService.listOrphanReturns`) is the authority on that.
   */
  orphaned: number;
  /**
   * Candidates the source no longer knows about (404). Counted, logged, and the
   * page CONTINUES — a return withdrawn or purged at the source must not abort
   * a page of unrelated work, and it is not a fault OL can act on.
   */
  notFound: number;
  /** Per-item failures other than a 404: counted, logged, loop continues. */
  failed: number;
  /** Total rows matching the candidate filter, for cursor wrap. */
  total: number;
  /** Caller's next scan offset (wraps to 0 at `total`). */
  nextOffset: number;
  /**
   * Whether the connection's adapter declared a terminal status vocabulary.
   *
   * `false` means the sweep ran in its DEGRADED mode — bounded by age and budget
   * alone, re-reading returns the source may well consider finished. Reported so
   * that a larger-than-expected `scanned` has a visible explanation rather than
   * looking like a defect.
   */
  terminalVocabularyDeclared: boolean;
}

export interface IReturnStatusSyncService {
  /**
   * Re-read one bounded page of this connection's non-terminal returns.
   *
   * Enqueues NOTHING — the re-reads happen inline, so a page of lifecycle work
   * can never fan out into an unbounded child wave.
   *
   * A connection whose adapter does not read returns yields a zero result
   * rather than an error.
   */
  sync(
    connectionId: string,
    options: ReturnStatusSyncOptions
  ): Promise<ReturnStatusSyncResult>;
}
