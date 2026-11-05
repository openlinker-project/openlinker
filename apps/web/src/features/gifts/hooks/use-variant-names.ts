/**
 * Product names for the variant ids a saved rule holds (#3940)
 *
 * A rule stores internal ids; the composer shows names. One variant read and one
 * product read per id, cached, so opening a rule costs a couple of requests and
 * the list never needs them.
 *
 * @module apps/web/src/features/gifts/hooks
 */
import { useQueries } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useVariantNames(variantIds: readonly string[]): ReadonlyMap<string, string> {
  const apiClient = useApiClient();
  const unique = [...new Set(variantIds.filter((id) => id !== ''))];
  const results = useQueries({
    queries: unique.map((variantId) => ({
      queryKey: ['gifts', 'variant-name', variantId],
      queryFn: async (): Promise<string> => {
        const variant = await apiClient.products.getVariant(variantId);
        const product = await apiClient.products.getById(variant.productId);
        return product.name;
      },
      staleTime: 5 * 60 * 1000,
    })),
  });
  const names = new Map<string, string>();
  unique.forEach((id, index) => {
    const name = results[index]?.data;
    if (name !== undefined) names.set(id, name);
  });
  return names;
}
