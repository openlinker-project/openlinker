/**
 * Invoice Numbering Series Repository Port
 *
 * Persistence contract for the numbering-series aggregate + connection
 * assignment (#1575). The `allocateNumber` primitive is the fiscal core: a single
 * atomic `UPDATE ... RETURNING` that resolves the period reset and advances the
 * sequence with no check-then-increment race, then persists the rendered number
 * onto the invoice record IN THE SAME TRANSACTION. Minimal surface — read/CRUD
 * helpers the C2 API layer needs plus the allocation primitive; no HTTP concern.
 *
 * @module libs/core/src/invoicing/domain/ports
 */
import type { InvoiceNumberingSeries } from '../entities/invoice-numbering-series.entity';
import type {
  AllocatedNumber,
  CreateInvoiceNumberingSeriesInput,
  SeriesAssignmentData,
  UpdateInvoiceNumberingSeriesInput,
} from '../types/invoice-numbering.types';

export interface InvoiceNumberingSeriesRepositoryPort {
  /** Insert a new numbering series. */
  createSeries(input: CreateInvoiceNumberingSeriesInput): Promise<InvoiceNumberingSeries>;

  findSeriesById(id: string): Promise<InvoiceNumberingSeries | null>;

  /** List every series (newest-first). Backs the C2 series list + orphan re-attach. */
  listSeries(): Promise<InvoiceNumberingSeries[]>;

  /**
   * List series NOT referenced by any assignment (orphaned) — backs the C2
   * "re-attach an existing unassigned series" flow.
   */
  listUnassignedSeries(): Promise<InvoiceNumberingSeries[]>;

  /**
   * Apply a patch to a series. Numbers already assigned are immutable; lowering
   * `nextSeq` is permitted. Throws `InvoiceNumberingSeriesNotFoundException` when
   * the id is unknown.
   */
  updateSeries(
    id: string,
    patch: UpdateInvoiceNumberingSeriesInput,
  ): Promise<InvoiceNumberingSeries>;

  /** Read the assignment for a connection; `null` when none is configured. */
  findAssignmentByConnectionId(connectionId: string): Promise<SeriesAssignmentData | null>;

  /**
   * Create or replace the connection's assignment (main + optional correction
   * series). Detachable pointer — never cascade-deletes a series.
   */
  upsertAssignment(input: {
    connectionId: string;
    mainSeriesId: string;
    correctionSeriesId: string | null;
  }): Promise<SeriesAssignmentData>;

  /**
   * Atomically allocate the next number from `seriesId` for `recordId` and
   * persist the rendered number onto the invoice record, ALL IN ONE TRANSACTION
   * (#1575). The series advance is a single guarded `UPDATE ... RETURNING` that
   * resolves the period reset inside the statement (no check-then-increment
   * race); the rendered number is written onto the record under a
   * `documentNumber IS NULL` guard so a re-run cannot double-allocate. The
   * document issue date drives both the date variables and the period key.
   *
   * Throws `InvoiceNumberingSeriesNotFoundException` when the series is missing,
   * `InvoiceRecordNotFoundException` when the record is missing, and
   * `DuplicateDocumentNumberException` when the rendered number collides with an
   * already-issued one (the last-line-of-defense unique index fired — e.g. after
   * a `nextSeq` rollback).
   */
  allocateNumber(input: {
    seriesId: string;
    recordId: string;
    connectionId: string;
    issueDate: Date;
  }): Promise<AllocatedNumber>;
}
