/**
 * Return Ingestion Service Interface
 *
 * The two-method contract behind #2330's discovery pass and its per-return
 * child — the returns counterpart of `IOrderIngestionService`, and deliberately
 * the same shape, because the cursor-safety rule it encodes is the same rule.
 *
 * @module libs/core/src/returns/application/services
 */
export interface ReturnIngestionOptions {
  /** Connection-cursor key holding the opaque source feed cursor. */
  cursorKey: string;
  /** Page size requested from the source. */
  limit: number;
}

/**
 * What one discovery run did.
 *
 * Mirrors `OrderIngestionResult` field for field — `fetched` / `enqueued` /
 * `nextCursor` / `committed` / `skippedDueToLock` — so a reader who knows one
 * poll path knows both, and adds two counters of its own.
 *
 * `committed` is the one to read when asking "did this run make progress it can
 * never repeat?". It is FALSE whenever the cursor was held, which includes the
 * ordinary empty-page case; that is not a fault.
 *
 * **Why there are no `attributed` / `orphaned` counts here.** The discovery pass
 * does not write returns — it enqueues children that do — so at the moment this
 * result is produced no attribution has been attempted and none can honestly be
 * reported. Emitting `attributed: 0` would not be a missing number, it would be
 * a false one: indistinguishable from a page where every return genuinely failed
 * to resolve its order. The counts live where the writes are — per call on
 * {@link ReturnSyncResult}, and aggregated on the pass-2 sweep result, which
 * upserts inline. A consumer wanting a connection's orphan rate reads the orphan
 * bucket itself (`IReturnsService.listOrphanReturns`): the row is the authority,
 * not any one run's counter.
 */
export interface ReturnIngestionResult {
  /** Feed items the source returned this page. */
  fetched: number;
  /** Child `marketplace.return.sync` jobs enqueued for them. */
  enqueued: number;
  /** The cursor the source reported, whether or not it was committed. */
  nextCursor: string | null;
  /** Whether the persisted cursor actually advanced. */
  committed: boolean;
  /** Whether another run held the per-connection lock and this one stood down. */
  skippedDueToLock: boolean;
  /**
   * Feed items dropped because the source reported no return id.
   *
   * Counted rather than thrown: a single malformed item must never wedge the
   * cursor for the whole connection, and an operator needs to see that
   * something is being dropped rather than infer it from a gap.
   */
  droppedWithoutId: number;
}

/**
 * What one hydrate-and-persist child did.
 *
 * `attributed` is the per-call observation `IReturnsService` reports — it says
 * "this call resolved the order", never "this return is attributed", since
 * attribution is monotonic in the database.
 */
export interface ReturnSyncResult {
  /** The OL return id the observation converged on. */
  returnId: string;
  /** Whether THIS call resolved the source order to an OL one. */
  attributed: boolean;
}

export interface IReturnIngestionService {
  /**
   * Pass 1 — discovery. Read one cursor-paged page of the source's return
   * feed, enqueue one child per item, and commit the cursor **only** once every
   * enqueue succeeded.
   *
   * Single-flight per connection via a lock; a connection whose adapter does
   * not implement `ReturnSourceReader` yields a zero result rather than an
   * error.
   */
  ingestReturns(
    connectionId: string,
    options: ReturnIngestionOptions
  ): Promise<ReturnIngestionResult>;

  /**
   * The per-return child: hydrate one return from the source and persist it
   * idempotently. Also the whole of pass 2's per-item work, which is why it is
   * a method rather than a private step — a re-read and a first read are the
   * same operation.
   */
  syncReturnFromSource(
    connectionId: string,
    externalReturnId: string
  ): Promise<ReturnSyncResult>;
}
