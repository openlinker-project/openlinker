/**
 * Delivery on documents - query key factory (#3908)
 *
 * @module apps/web/src/features/delivery-on-documents/api
 */
export const deliveryOnDocumentsQueryKeys = {
  all: ['delivery-on-documents'] as const,
  suggestions: () => ['delivery-on-documents', 'suggestions'] as const,
  countryFacts: (connectionId: string) =>
    ['delivery-on-documents', 'country-facts', connectionId] as const,
};
