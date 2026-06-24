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
}
