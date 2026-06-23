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
   * Select `issued` records on the connection whose regulatory status is
   * NON-terminal (NOT in `TerminalRegulatoryStatusValues` — so receipts /
   * `not-applicable` are excluded structurally). Ordered `updatedAt ASC, id ASC`
   * (oldest-reconciled-first), capped at `opts.limit` — NO offset (the
   * reconciliation frontier is a SHRINKING set, walked from offset 0 every run;
   * see #1121 plan decision #5). Backs the regulatory-status reconciliation job.
   */
  findIssuedNonTerminal(
    connectionId: string,
    opts: { limit: number },
  ): Promise<{ items: InvoiceRecord[]; total: number }>;
}
