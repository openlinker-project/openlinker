import type { ProductFilters, ProductListSort, ProductPagination } from './products.types';

export const productsQueryKeys = {
  all: ['products'] as const,
  // Every filter/sort dimension is spelled out (rather than passing the raw
  // objects) so key identity is stable across `undefined` vs missing fields
  // and array identity churn (#1720).
  list: (filters?: ProductFilters, pagination?: ProductPagination, sort?: ProductListSort) =>
    [
      'products',
      'list',
      filters?.search ?? '',
      filters?.stock ?? 'any',
      filters?.unlistedOn?.join(',') ?? '',
      filters?.connectionId ?? 'all',
      sort?.field ?? 'default',
      sort?.dir ?? 'default',
      pagination ?? {},
    ] as const,
  detail: (id: string) => ['products', 'detail', id] as const,
  variant: (variantId: string) => ['products', 'variant', variantId] as const,
};
