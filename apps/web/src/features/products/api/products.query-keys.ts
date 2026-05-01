import type { ProductFilters, ProductPagination } from './products.types';

export const productsQueryKeys = {
  all: ['products'] as const,
  list: (filters?: ProductFilters, pagination?: ProductPagination) =>
    ['products', 'list', filters ?? {}, pagination ?? {}] as const,
  detail: (id: string) => ['products', 'detail', id] as const,
  variant: (variantId: string) => ['products', 'variant', variantId] as const,
};
