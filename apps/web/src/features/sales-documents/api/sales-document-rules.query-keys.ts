/**
 * Sales-Document Rules — query key factory (#2170)
 *
 * @module apps/web/src/features/sales-documents/api
 */
export const salesDocumentRulesQueryKeys = {
  all: ['sales-document-rules'] as const,
  rules: (country: string) => ['sales-document-rules', 'rules', country] as const,
  countryDefaults: (country: string) =>
    ['sales-document-rules', 'country-defaults', country] as const,
  thresholds: () => ['sales-document-rules', 'thresholds'] as const,
  template: (country: string) => ['sales-document-rules', 'template', country] as const,
  countries: () => ['sales-document-rules', 'countries'] as const,
};
