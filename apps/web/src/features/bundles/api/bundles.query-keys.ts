export const bundlesQueryKeys = {
  all: ['bundles'] as const,
  detail: (variantId: string) => ['bundles', 'detail', variantId] as const,
  history: (variantId: string) => ['bundles', 'history', variantId] as const,
  usedIn: (variantId: string) => ['bundles', 'used-in', variantId] as const,
};
