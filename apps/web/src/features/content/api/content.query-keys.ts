/**
 * Content Feature — Query Key Factory
 *
 * @module apps/web/src/features/content/api
 */
export const contentQueryKeys = {
  all: ['content'] as const,
  forProduct: (productId: string) => ['content', 'product', productId] as const,
};
