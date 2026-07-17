/**
 * Invoice Record Repository Port
 *
 * Persistence contract for `InvoiceRecord` rows. Minimal surface — only what an
 * application service needs (no findAll/pagination until a consumer asks).
 * `findByIdempotencyKey` is the read half of the exactly-once issue gate.
 *
 * @module libs/core/src/invoicing/domain/ports
 */
import type { InvoiceRecord } from '../entities/invoice-record.entity';
import type {
  CreateInvoiceRecordInput,
  InvoiceOutcomePatch,
  InvoiceRecordFilters,
  InvoiceRecordPagination,
  PaginatedInvoiceRecords,
} from '../types/invoicing.types';

export interface InvoiceRecordRepositoryPort {
  /**
   * Insert a new record. Throws `DuplicateInvoiceRecordException` when it
   * collides with the `(connectionId, idempotencyKey)` dedup guard.
   */
  create(input: CreateInvoiceRecordInput): Promise<InvoiceRecord>;

  findById(id: string): Promise<InvoiceRecord | null>;

  findByOrderId(orderId: string, connectionId: string): Promise<InvoiceRecord | null>;

  /**
   * List every record that consumed a sequence from a numbering series (#8) -
   * i.e. rows whose `numberingSeriesId` matches AND `allocatedSeq IS NOT NULL`.
   * Ordered by `allocatedSeq` ASC (then `createdAt` ASC for determinism). Backs
   * the numbering gap-audit read model; returns `[]` for a series that has
   * allocated nothing yet.
   */
  findBySeriesId(seriesId: string): Promise<InvoiceRecord[]>;

  /**
   * Find the most-recently-created record for an order across all connections.
   * Backs the order-detail invoice projection (#1224) where the invoicing
   * connection is not known to the caller; `null` when the order has no record.
   */
  findLatestByOrderId(orderId: string): Promise<InvoiceRecord | null>;

  /**
   * Batch counterpart of {@link findLatestByOrderId} (#1713): the most-recently-
   * created record for each of the given order ids, at most one per order. Backs
   * the orders-list invoice projection, which needs one query for the whole page
   * rather than an N+1 of per-row `findLatestByOrderId`. Orders with no record
   * are simply absent from the result; returns `[]` for an empty input.
   */
  findLatestByOrderIds(orderIds: string[]): Promise<InvoiceRecord[]>;

  /**
   * Find the most-recently-created record for a provider invoice id on the
   * connection (#1354). Backs the payment-status refresh triggered by a
   * provider payment webhook, which names the document by its provider id;
   * `null` when no row matches.
   */
  findByProviderInvoiceId(
    connectionId: string,
    providerInvoiceId: string,
  ): Promise<InvoiceRecord | null>;

  /** Read half of the exactly-once gate; `null` when no row holds the key. */
  findByIdempotencyKey(
    connectionId: string,
    idempotencyKey: string,
  ): Promise<InvoiceRecord | null>;

  /**
   * Apply an outcome patch to an existing record. Throws
   * `InvoiceRecordNotFoundException` when the id does not exist.
   */
  updateOutcome(id: string, patch: InvoiceOutcomePatch): Promise<InvoiceRecord>;

  /**
   * Atomic compare-and-swap claim of the in-flight issuance slot (#1200, closes
   * R2 + the `pending` half of R3). Conditionally flips a record to `issuing`
   * with a fresh lease ONLY when no live attempt already holds it AND a re-attempt
   * is fiscally safe — i.e. the row is `pending`, OR a TERMINAL-`rejected` `failed`
   * row (provider definitely created no document), OR `issuing` with an EXPIRED
   * lease (a crashed prior attempt whose lease lapsed). An in-doubt/mode-less
   * `failed` row is NEVER claimed here (a document may already exist) — the fiscal
   * invariant is enforced at this persistence boundary, not only in the service.
   * Performed as a single guarded UPDATE so exactly one concurrent same-key retry
   * can win the slot.
   *
   * Returns the claimed record (now `issuing`, lease = `leaseExpiresAt`) on a
   * WIN; returns `null` when the slot is held by a live `issuing` lease, the row
   * is already terminal (`issued`), or it is an in-doubt `failed` row — the caller
   * MUST then back off WITHOUT crossing the provider boundary. NEVER claims an
   * `issued` row.
   *
   * The fiscal contract: a `null` return is a SAFE non-action (a stuck/contended
   * record is preferable to a double-issued document). Throws
   * `InvoiceRecordNotFoundException` when the id does not exist.
   */
  claimForIssue(id: string, leaseExpiresAt: Date): Promise<InvoiceRecord | null>;

  /**
   * Read-only paginated list (#1119). Backs ONLY the AC-6 list endpoint;
   * ordered newest-first (`createdAt` DESC). The POST re-issue gate is served by
   * `findByOrderId` (the single-row order primitive), NOT this list query, so
   * the filter surface stays scoped to AC-6.
   */
  findMany(
    filter: InvoiceRecordFilters,
    pagination: InvoiceRecordPagination,
  ): Promise<PaginatedInvoiceRecords>;

  /**
   * Select `issued` records on the connection whose regulatory status is
   * NON-terminal (NOT in `TerminalRegulatoryStatusValues` — so receipts /
   * `not-applicable` are excluded structurally). Ordered `updatedAt ASC, id ASC`
   * (oldest-first, fully deterministic tie-break on `id`), capped at `opts.limit`.
   *
   * KEYSET PAGING (#1121 plan decision #5, revised on #1206): when `opts.cursor`
   * is supplied the page is bounded to rows strictly AFTER it in
   * `(updatedAt, id)` order — `(updatedAt, id) > (cursor.updatedAt, cursor.id)`.
   * The service threads the last-seen `(updatedAt, id)` across pages within one
   * run so the whole non-terminal frontier is visited even when the oldest rows
   * never change `updatedAt` (a no-op read does NOT bump it). `total` is the full
   * non-terminal count for the connection (computed on page 1 only) — for
   * coverage logging. The `IDX_invoice_records_reconcile` partial index narrows
   * the candidate set to the non-terminal frontier; the keyset compares on
   * `date_trunc('milliseconds', updatedAt)` (matching the JS `Date` cursor
   * resolution), which the raw-column index cannot fully serve, so the ordering
   * is an in-memory sort over that already-narrowed set — not a full index-only scan.
   */
  findIssuedNonTerminal(
    connectionId: string,
    opts: {
      limit: number;
      cursor?: { updatedAt: Date; id: string };
    },
  ): Promise<{ items: InvoiceRecord[]; total: number }>;

  /**
   * Select records on the connection whose regulatory status is
   * `pending-submission` (#1702) - documents issued with legal effect during a
   * degraded-mode outage that still await retransmission to the authority.
   * Ordered `updatedAt ASC, id ASC` (oldest-first, deterministic `id` tie-break),
   * capped at `opts.limit`.
   *
   * KEYSET PAGING (mirrors `findIssuedNonTerminal`): when `opts.cursor` is
   * supplied the page is bounded to rows strictly AFTER it in `(updatedAt, id)`
   * order - `(updatedAt, id) > (cursor.updatedAt, cursor.id)`. The offline-resubmit
   * sweep threads the last-seen `(updatedAt, id)` across pages within one run so
   * the whole pending-submission frontier is visited even when the oldest rows
   * never bump `updatedAt` (a still-unreachable authority leaves the record
   * untouched). `total` is the full pending-submission count for the connection
   * (computed on page 1 only) - for coverage logging. The
   * `IDX_invoice_records_pending_submission` partial index narrows the candidate
   * set to the pending-submission frontier; the keyset compares on
   * `date_trunc('milliseconds', updatedAt)`, which the raw-column index cannot
   * fully serve, so the ordering is an in-memory sort over that narrowed set.
   */
  findPendingSubmission(
    connectionId: string,
    opts: {
      limit: number;
      cursor?: { updatedAt: Date; id: string };
      /**
       * Settling-margin upper bound (#1585 B1): when supplied, only rows whose
       * `updatedAt <= olderThan` are selected. The offline-resubmit sweep passes
       * `now - settlingMargin` so a document that LANDED at the authority but is
       * not yet visible in its (eventually-consistent) metadata index has time to
       * appear before a `null` locate is trusted as a genuine non-receipt — closing
       * the false-`null` double-issue window. Absent = no lower age bound.
       */
      olderThan?: Date;
    },
  ): Promise<{ items: InvoiceRecord[]; total: number }>;

  /**
   * Atomic compare-and-swap claim of a `pending-submission` record for the
   * offline-resubmit sweep (#1585 B1). A SINGLE guarded UPDATE stamps a fresh
   * `leaseExpiresAt` ONLY when the row is still `pending-submission` AND no live
   * lease already holds it (`leaseExpiresAt IS NULL OR <= now`). Postgres
   * serialises the row-level write, so of two overlapping sweep runs (or a run
   * racing the live issuance path) exactly one wins the claim; the loser's
   * `affected` is 0 and it MUST skip the record WITHOUT resubmitting — this is the
   * per-record guard that prevents two runs both seeing `null` from the locator
   * and both resubmitting the same document.
   *
   * Returns the claimed row on a WIN, `null` on a contended loss (or if the row
   * is no longer `pending-submission`). Throws `InvoiceRecordNotFoundException`
   * when the id does not exist. The caller releases the lease (patch
   * `leaseExpiresAt: null`) on its terminal `updateOutcome`, or explicitly when it
   * leaves the record `pending-submission` for the next run.
   */
  claimPendingSubmission(id: string, leaseExpiresAt: Date): Promise<InvoiceRecord | null>;

  /**
   * Select records on the connection that are STUCK mid-issuance (#1703) - a
   * process died between a successful provider submit and the terminal
   * `updateOutcome`, leaving the row non-terminal with no live attempt. Two
   * shapes qualify, both gated by the caller-supplied `olderThan` safety margin
   * so a legitimately in-flight attempt is NEVER swept:
   *   - `status = 'pending'` whose `updatedAt <= olderThan` (a row that was
   *     created but never advanced - the crash happened before the CAS claim, or
   *     `POST /invoices/retry` deliberately skips `pending`);
   *   - `status = 'issuing'` whose `leaseExpiresAt <= olderThan` (a crashed
   *     attempt whose CAS lease expired at least the safety margin ago; a row
   *     with a null lease is NOT selected - it cannot be a lapsed claim).
   * Connection-scoped, ordered `updatedAt ASC, id ASC` (oldest-first,
   * deterministic `id` tie-break), capped at `opts.limit`.
   *
   * KEYSET PAGING (mirrors `findPendingSubmission`): when `opts.cursor` is
   * supplied the page is bounded to rows strictly AFTER it in `(updatedAt, id)`
   * order - `(updatedAt, id) > (cursor.updatedAt, cursor.id)`. The recovery sweep
   * threads the last-seen `(updatedAt, id)` across pages within one run so the
   * whole stuck frontier is visited even when the oldest rows never bump
   * `updatedAt`. `total` is the full stuck count for the connection, computed on
   * PAGE 1 ONLY (returns `0` on cursor pages, like `findPendingSubmission` /
   * `findIssuedNonTerminal`) - for coverage logging only.
   *
   * `pending` / `issuing` are transient, low-cardinality states, so the existing
   * `IDX_invoice_records_status` on `(status)` serves the seek without a
   * dedicated partial index (#1703).
   */
  findStuckPending(
    connectionId: string,
    opts: {
      olderThan: Date;
      limit: number;
      cursor?: { updatedAt: Date; id: string };
    },
  ): Promise<{ items: InvoiceRecord[]; total: number }>;
}
