/**
 * Sales-Document Country Default Repository Port (#2170, #3177)
 *
 * @module libs/core/src/sales-documents/domain/ports
 */
import type { SalesDocumentCountryDefault } from '../entities/sales-document-country-default.entity';
import type { SalesDocumentCountryDefaultInput } from '../types/sales-document-rule-write.types';

export interface SalesDocumentCountryDefaultRepositoryPort {
  findById(id: string): Promise<SalesDocumentCountryDefault | null>;

  /** At most one default row for one country (or `*`) — unique on `country` alone (#3177). */
  findByCountry(country: string): Promise<SalesDocumentCountryDefault[]>;

  /**
   * Batch counterpart of {@link findByCountry} (#2516) — see the identically
   * shaped `SalesDocumentRuleRepositoryPort.findByCountries` for why it
   * exists. Returns `[]` for an empty input.
   */
  findByCountries(countries: readonly string[]): Promise<SalesDocumentCountryDefault[]>;

  /** Every country default across every country — the countries-listing read's (#2186) merge input. */
  findAll(): Promise<SalesDocumentCountryDefault[]>;

  /**
   * Insert, or replace the existing row's `documentKind` + `connectionId`.
   * The conflict target is `country` ALONE (#3177) — upserting under a
   * DIFFERENT `documentKind` for a country that already has a default
   * overwrites it rather than inserting a sibling row.
   */
  upsert(input: SalesDocumentCountryDefaultInput): Promise<SalesDocumentCountryDefault>;

  delete(id: string): Promise<void>;
}
