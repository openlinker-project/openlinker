/**
 * Sales-Document Rule Repository Port (#2170)
 *
 * @module libs/core/src/sales-documents/domain/ports
 */
import type { SalesDocumentRule } from '../entities/sales-document-rule.entity';
import type { SalesDocumentRuleInput } from '../types/sales-document-rule-write.types';

export interface SalesDocumentRuleRepositoryPort {
  findById(id: string): Promise<SalesDocumentRule | null>;

  /**
   * Batch counterpart of {@link findById} (#3186): every rule named by `ids`,
   * in no particular order. Backs the per-order sales-document projection's
   * "Why this kind?" disclosure, which resolves a whole page's matched rules
   * in one query rather than one per row. Returns `[]` for an empty input; an
   * id naming a since-deleted rule is simply absent from the result — the read
   * side treats that identically to "no rule ever matched".
   */
  findByIds(ids: readonly string[]): Promise<SalesDocumentRule[]>;

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
