/**
 * Sales-Document Rule Repository Port (#2170)
 *
 * @module libs/core/src/sales-documents/domain/ports
 */
import type { SalesDocumentRule } from '../entities/sales-document-rule.entity';
import type { SalesDocumentRuleInput } from '../types/sales-document-rule-write.types';

export interface SalesDocumentRuleRepositoryPort {
  findById(id: string): Promise<SalesDocumentRule | null>;

  /** All rules for one country (or `*`), in no particular order. */
  findByCountry(country: string): Promise<SalesDocumentRule[]>;

  /**
   * Batch counterpart of {@link findByCountry} (#2516): every rule targeting
   * any of `countries`, in no particular order. Backs the batched routing
   * resolve behind the per-order sales-document projection, which evaluates a
   * whole page of orders and must not issue one query per country. Returns
   * `[]` for an empty input; a country with no rules is simply absent from the
   * result.
   */
  findByCountries(countries: readonly string[]): Promise<SalesDocumentRule[]>;

  /**
   * Existing rules sharing `(country, conditionsHash)` — the conflict guard's
   * candidate pool, before the caller applies the effective-date-overlap +
   * different-connection check.
   */
  findByCountryAndConditionsHash(country: string, conditionsHash: string): Promise<SalesDocumentRule[]>;

  create(input: SalesDocumentRuleInput & { conditionsHash: string }): Promise<SalesDocumentRule>;

  delete(id: string): Promise<void>;

  /**
   * Rule count per country (or `*`) — the countries-listing read's (#2186)
   * merge input. A country with zero rules is simply absent from the map;
   * the caller defaults it to `0`.
   */
  countRulesByCountry(): Promise<Map<string, number>>;
}
