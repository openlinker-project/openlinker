import type { ProductFilters, ProductListSort, ProductPagination } from './products.types';

/**
 * Every filter dimension spelled out (rather than the raw object) so key
 * identity is stable across `undefined` vs missing fields and array identity
 * churn (#1720). Shared by `list`, `rows` and `count` so the three cannot
 * disagree about what "the same filters" means (#2947).
 */
function productFilterKey(filters?: ProductFilters): readonly unknown[] {
  return [
    filters?.search ?? '',
    filters?.stock ?? 'any',
    filters?.unlistedOn?.join(',') ?? '',
    filters?.taxRateState ?? '',
    filters?.connectionId ?? 'all',
    filters?.hideFullyStale ?? false,
  ];
}

export const productsQueryKeys = {
  all: ['products'] as const,
  list: (filters?: ProductFilters, pagination?: ProductPagination, sort?: ProductListSort) =>
    [
      'products',
      'list',
      ...productFilterKey(filters),
      sort?.field ?? 'default',
      sort?.dir ?? 'default',
      pagination ?? {},
    ] as const,
  /** The rows-only page (#2947) - a different response shape, so a different key. */
  rows: (filters?: ProductFilters, pagination?: ProductPagination, sort?: ProductListSort) =>
    ['products', 'rows', ...productFilterKey(filters), sort?.field ?? 'default', sort?.dir ?? 'default', pagination ?? {}] as const,
  /**
   * The two-stage total (#2947). Carries NEITHER pagination NOR sort: the
   * answer depends on the filters alone, so paging or re-sorting reuses one
   * cached count instead of recomputing the aggregate.
   */
  count: (filters?: ProductFilters) => ['products', 'count', ...productFilterKey(filters)] as const,
  detail: (id: string) => ['products', 'detail', id] as const,
  variant: (variantId: string) => ['products', 'variant', variantId] as const,
};
