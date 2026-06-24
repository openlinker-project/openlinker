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
