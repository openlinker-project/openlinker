/**
 * Numbering Series Service Interface
 *
 * Application-service contract for the invoice numbering-series module (#9/#10):
 * series CRUD and per-document-type routing (VAT/KOR/ZAL/ROZ -> series, optional
 * register scope). This is the cross-context seam the API layer codes against —
 * the controller injects THIS `I*Service`, never the repository port. The service
 * OWNS pattern validation (`assertValidNumberingPattern`) and periodKey seeding;
 * no numbering domain logic leaks into the interface layer. Allocation stays in
 * the repository + `InvoiceService` and is intentionally not exposed here.
 * Country-agnostic (ADR-026): neutral document numbers, patterns, and routes only.
 *
 * @module libs/core/src/invoicing/application/services
 */
import type { InvoiceNumberingSeries } from '../../domain/entities/invoice-numbering-series.entity';
import type {
  CreateNumberingSeriesServiceInput,
  DeleteSeriesRouteInput,
  ListNumberingSeriesFilter,
  SeriesRouteData,
  UpdateNumberingSeriesServiceInput,
  UpsertSeriesRouteInput,
} from '../../domain/types/invoice-numbering.types';

export interface INumberingSeriesService {
  /**
   * Create a numbering series. Validates the pattern against its reset policy
   * (throws `InvalidNumberingPatternException` on a coverage gap) and seeds the
   * `periodKey` from the reset policy before persisting. `documentType` defaults
   * to the neutral base type when omitted; `register` defaults to `null`.
   */
  createSeries(input: CreateNumberingSeriesServiceInput): Promise<InvoiceNumberingSeries>;

  /** Read a series by id; `null` when unknown. */
  getSeries(id: string): Promise<InvoiceNumberingSeries | null>;

  /**
   * List series (newest-first), optionally filtered by `documentType` / `register`
   * (#10). An absent filter field is not applied.
   */
  listSeries(filter?: ListNumberingSeriesFilter): Promise<InvoiceNumberingSeries[]>;

  /** List series not referenced by any routing rule (orphaned) — backs the re-attach flow. */
  listUnassignedSeries(): Promise<InvoiceNumberingSeries[]>;

  /**
   * Apply a partial patch. Throws `InvoiceNumberingSeriesNotFoundException` when
   * the id is unknown. Re-validates the EFFECTIVE (merged) pattern + reset policy
   * whenever either changes, and re-seeds `periodKey` on a reset-policy change so
   * the next allocation's rollover detection stays coherent.
   */
  updateSeries(
    id: string,
    patch: UpdateNumberingSeriesServiceInput,
  ): Promise<InvoiceNumberingSeries>;

  /** List every routing rule for a connection (#9/#10). */
  findRoutesByConnectionId(connectionId: string): Promise<SeriesRouteData[]>;

  /**
   * Create or replace a routing rule keyed by the full tuple
   * `(connectionId, documentType, register, currency, source)` (#1694). Callers
   * must ensure the referenced series exists (see {@link seriesExists}) — this
   * is a detachable pointer, never a cascade.
   */
  upsertRoute(input: UpsertSeriesRouteInput): Promise<SeriesRouteData>;

  /** Remove a routing rule (the referenced series survives). No-op when absent. */
  deleteRoute(
    connectionId: string,
    documentType: string,
    axes: DeleteSeriesRouteInput,
  ): Promise<void>;

  /** Whether a series with the given id exists — backs the routing 400-on-unknown guard. */
  seriesExists(id: string): Promise<boolean>;
}
