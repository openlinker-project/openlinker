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
  DeleteSeriesRouteInput,
  SeriesRouteData,
  SeriesRouteMatchAxes,
  UpdateInvoiceNumberingSeriesInput,
  UpsertSeriesRouteInput,
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

  /**
   * Resolve the series id that numbers a connection's document of `documentType`,
   * given the document's optional `register` / `currency` / `source` axes
   * (#9 / #10 / #1694). Resolution is MOST-SPECIFIC-MATCH-WINS with a FIXED
   * fallback precedence — the most specific axis is dropped (widened to a
   * wildcard route) until a route matches:
   *   1. exact `(register, currency, source)`;
   *   2. drop `source`   -> `(register, currency, *)`;
   *   3. drop `currency` -> `(register, *, *)`;
   *   4. drop `register` -> `(*, *, *)` — the type's register-less default.
   * The first matching route wins. Returns `null` when no route matches.
   * Correction→base-type fallback is a caller (`InvoiceService`) concern, not
   * this method's.
   */
  findSeriesIdForDocument(
    connectionId: string,
    documentType: string,
    axes: SeriesRouteMatchAxes,
  ): Promise<string | null>;

  /** List every routing rule for a connection (#9 / #10 / #1694). Backs the C2 routing surface. */
  findRoutesByConnectionId(connectionId: string): Promise<SeriesRouteData[]>;

  /**
   * Create or replace a routing rule keyed by the full tuple
   * `(connectionId, documentType, register, currency, source)` (#1694).
   * Detachable pointer — never cascade-deletes a series.
   */
  upsertRoute(input: UpsertSeriesRouteInput): Promise<SeriesRouteData>;

  /**
   * Remove a routing rule (C2 "detach" flow). Removes only the detachable
   * pointer — the referenced series survives. A no-op when no route matches the
   * `(connectionId, documentType, register, currency, source)` key (#1694).
   */
  deleteRoute(
    connectionId: string,
    documentType: string,
    axes: DeleteSeriesRouteInput,
  ): Promise<void>;

  /**
   * Atomically allocate the next number from `seriesId` for `recordId` and
   * persist the rendered number onto the invoice record, ALL IN ONE TRANSACTION
   * (#1575). The series advance is a single guarded `UPDATE ... RETURNING` that
   * resolves the period reset inside the statement (no check-then-increment
   * race); the rendered number is written onto the record under a
   * `documentNumber IS NULL` guard so a re-run cannot double-allocate. The
   * document issue date drives both the date variables and the period key, both
   * resolved in `timeZone` (the seller's IANA zone, #7).
   *
   * Throws `InvoiceNumberingSeriesNotFoundException` when the series is missing,
   * `InvoiceRecordNotFoundException` when the record is missing,
   * `DuplicateDocumentNumberException` when the rendered number collides with an
   * already-issued one (the last-line-of-defense unique index fired — e.g. after
   * a `nextSeq` rollback), and `DocumentNumberTooLongException` when the rendered
   * number exceeds `maxDocumentNumberLength` (#11).
   */
  allocateNumber(input: {
    seriesId: string;
    recordId: string;
    connectionId: string;
    issueDate: Date;
    /** Seller IANA timezone the date variables + period key resolve in (#7). */
    timeZone: string;
    /** Provider max document-number length; over-length renders throw (#11). Absent = no limit. */
    maxDocumentNumberLength?: number;
  }): Promise<AllocatedNumber>;
}
