/**
 * Fiscalization query keys (#1909)
 *
 * @module apps/web/src/features/fiscalization/api
 */

export const fiscalizationQueryKeys = {
  all: ['fiscalization'] as const,
  forOrder: (orderId: string) => ['fiscalization', 'order', orderId] as const,
};
