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
}
