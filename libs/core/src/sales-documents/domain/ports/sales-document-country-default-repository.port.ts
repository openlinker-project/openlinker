/**
 * Sales-Document Country Default Repository Port (#2170)
 *
 * @module libs/core/src/sales-documents/domain/ports
 */
import type { SalesDocumentCountryDefault } from '../entities/sales-document-country-default.entity';
import type { SalesDocumentCountryDefaultInput } from '../types/sales-document-rule-write.types';

export interface SalesDocumentCountryDefaultRepositoryPort {
  findById(id: string): Promise<SalesDocumentCountryDefault | null>;

  /** All defaults for one country (or `*`) — at most one per documentKind. */
  findByCountry(country: string): Promise<SalesDocumentCountryDefault[]>;

  /**
   * Batch counterpart of {@link findByCountry} (#2516) — see the identically
   * shaped `SalesDocumentRuleRepositoryPort.findByCountries` for why it
   * exists. Returns `[]` for an empty input.
   */
  findByCountries(countries: readonly string[]): Promise<SalesDocumentCountryDefault[]>;

  /** Every country default across every country — the countries-listing read's (#2186) merge input. */
  findAll(): Promise<SalesDocumentCountryDefault[]>;

  findByCountryAndKind(
    country: string,
    documentKind: string,
  ): Promise<SalesDocumentCountryDefault | null>;

  /** Insert, or replace the existing `(country, documentKind)` row's `connectionId`. */
  upsert(input: SalesDocumentCountryDefaultInput): Promise<SalesDocumentCountryDefault>;

  delete(id: string): Promise<void>;
}
