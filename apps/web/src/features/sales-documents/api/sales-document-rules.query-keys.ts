/**
 * Sales-Document Rules — query key factory (#2170)
 *
 * @module apps/web/src/features/sales-documents/api
 */
import type { CheckSalesDocumentRuleOverlapInput } from './sales-document-rules.types';

export const salesDocumentRulesQueryKeys = {
  all: ['sales-document-rules'] as const,
  rules: (country: string) => ['sales-document-rules', 'rules', country] as const,
  countryDefaults: (country: string) =>
    ['sales-document-rules', 'country-defaults', country] as const,
  thresholds: () => ['sales-document-rules', 'thresholds'] as const,
  template: (country: string) => ['sales-document-rules', 'template', country] as const,
  countries: () => ['sales-document-rules', 'countries'] as const,
  markets: () => ['sales-document-rules', 'markets'] as const,
  /**
   * The draft IS the key (#3190), passed as an OBJECT rather than a
   * `JSON.stringify`: TanStack's own `hashKey` serialises a key
   * deterministically with sorted object keys, whereas `JSON.stringify` is
   * insertion-order sensitive - so two identical drafts assembled in a
   * different field order would otherwise mint two cache entries and two
   * backend reads. Minted here rather than inline so `invalidateQueries({
   * queryKey: all })` reaches it by construction instead of by prefix
   * coincidence.
   */
  overlapCheck: (draft: CheckSalesDocumentRuleOverlapInput) =>
    ['sales-document-rules', 'overlap-check', draft] as const,
};
