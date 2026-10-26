/**
 * Order Search Text Reindex Types (#3507 G03-14)
 *
 * The page shape the `order_records.searchText` reindex pass reads, the write
 * it issues, and what one pass reports. See `OrderSearchTextReindexService`
 * for why the pass exists.
 *
 * @module libs/core/src/orders/domain/types
 */

/**
 * One row as the reindex pass reads it — the snapshot to derive from and the
 * text currently stored, so the pass can skip a row that already agrees.
 */
export interface OrderSearchTextReindexRow {
  readonly internalOrderId: string;
  readonly orderSnapshot: Record<string, unknown>;
  readonly searchText: string;
}

/**
 * One conditional rewrite. `expectedSearchText` is the value the pass READ:
 * the write applies only while the row still holds it, so a concurrent
 * ingestion that rewrote the row in between (with its own, current
 * derivation) is never overwritten by a value computed from a stale snapshot.
 */
export interface OrderSearchTextRewrite {
  readonly internalOrderId: string;
  readonly expectedSearchText: string;
  readonly searchText: string;
}

/** What one reindex pass did. */
export type OrderSearchTextReindexRunResult =
  | {
      /**
       * `OL_STORE_PII` is on: every write already indexes what the install
       * stores, and a stale row can only be MISSING personal data — never
       * leaking it — so there is nothing for this pass to repair.
       */
      readonly status: 'skipped-pii-stored';
    }
  | {
      readonly status: 'completed';
      /** Rows read and re-derived this pass. */
      readonly scanned: number;
      /** Rows whose stored text differed and were rewritten. */
      readonly rewritten: number;
      /**
       * `true` when the per-pass page budget ran out before the table did —
       * {@link nextCursor} then says where the next pass resumes.
       */
      readonly budgetExhausted: boolean;
      /** Keyset cursor (`internalOrderId`) to resume from, or `null` once the scan reached the end. */
      readonly nextCursor: string | null;
    };
