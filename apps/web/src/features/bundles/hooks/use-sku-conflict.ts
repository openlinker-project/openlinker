/**
 * Whether a typed SKU already belongs to a catalogue product (#3935).
 *
 * The shop would adopt that product on save and quietly drop what was typed on
 * the bundle step, so the form asks while the SKU is typed and blocks Next until
 * the operator adopts the product or changes the SKU. The match is on the
 * product's own SKU and on any of its variants' SKUs, exact and case-insensitive:
 * a free-text search alone returns near hits, which are not a conflict.
 *
 * @module apps/web/src/features/bundles/hooks
 */
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ApiClient } from '../../../app/api/api-client';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';

export interface SkuConflict {
  productId: string;
  name: string;
  sku: string;
}

const PROBE_LIMIT = 20;
/** Hits whose variants are not on the list row are opened one by one, but only this many. */
const DETAIL_LOOKUPS = 5;

/** The product that already owns this exact SKU, or `null`; shared by the wizard hook and the bulk table. */
export async function findSkuConflict(apiClient: ApiClient, probe: string): Promise<SkuConflict | null> {
  const wanted = probe.toLowerCase();
  const page = await apiClient.products.listRows({ search: probe }, { limit: PROBE_LIMIT, offset: 0 });
  const same = (value: string | null | undefined): boolean => (value ?? '').trim().toLowerCase() === wanted;
  for (const product of page.items) {
    if (same(product.sku) || (product.variants ?? []).some((variant) => same(variant.sku))) {
      return { productId: product.id, name: product.name, sku: probe };
    }
  }
  for (const product of page.items.filter((item) => item.variants === undefined).slice(0, DETAIL_LOOKUPS)) {
    try {
      const detail = await apiClient.products.getById(product.id);
      if ((detail.variants ?? []).some((variant) => same(variant.sku))) {
        return { productId: product.id, name: product.name, sku: probe };
      }
    } catch {
      // A product that cannot be opened is no proof of a conflict; the shop still decides on save.
    }
  }
  return null;
}

export const skuConflictQueryKey = (probe: string): readonly string[] => [
  'bundles',
  'sku-conflict',
  probe.toLowerCase(),
];

export function useSkuConflict(sku: string, enabled: boolean): SkuConflict | undefined {
  const apiClient = useApiClient();
  const typed = sku.trim();
  const probe = useDebouncedValue(typed, 300);
  const query = useQuery({
    queryKey: skuConflictQueryKey(probe),
    queryFn: () => findSkuConflict(apiClient, probe),
    enabled: enabled && probe.length >= 2,
    staleTime: 15_000,
  });
  // Stale while the operator is still typing: a verdict about an older SKU must not block this one.
  return probe === typed ? (query.data ?? undefined) : undefined;
}
