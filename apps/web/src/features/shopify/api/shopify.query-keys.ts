/**
 * Shopify query keys
 *
 * @module features/shopify/api
 */
export const shopifyQueryKeys = {
  all: ['shopify'] as const,
  locations: (connectionId: string) => ['shopify', 'locations', connectionId] as const,
};
