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
   * non-terminal count for the connection (cursor-independent) — for coverage
   * logging only. The `IDX_invoice_records_reconcile` partial index keys
   * `(updatedAt, id)` so the keyset seek stays index-only.
   */
  findIssuedNonTerminal(
    connectionId: string,
    opts: {
      limit: number;
      cursor?: { updatedAt: Date; id: string };
    },
  ): Promise<{ items: InvoiceRecord[]; total: number }>;
}
