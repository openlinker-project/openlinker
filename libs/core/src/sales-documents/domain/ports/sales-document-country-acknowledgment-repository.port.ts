/**
 * Sales-Document Country Acknowledgment Repository Port (#2186)
 *
 * @module libs/core/src/sales-documents/domain/ports
 */
import type { SalesDocumentCountryAcknowledgment } from '../entities/sales-document-country-acknowledgment.entity';

export interface SalesDocumentCountryAcknowledgmentRepositoryPort {
  /** Every acknowledged country — the countries-listing read's merge input. */
  findAll(): Promise<SalesDocumentCountryAcknowledgment[]>;

  /** Insert, or replace the existing row's `acknowledgedAt` with now. */
  upsert(country: string): Promise<SalesDocumentCountryAcknowledgment>;

  /** Idempotent — clearing an already-unacknowledged country is a no-op. */
  delete(country: string): Promise<void>;
}
