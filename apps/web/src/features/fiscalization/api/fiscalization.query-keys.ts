/**
 * Fiscalization query keys (#1909)
 *
 * @module apps/web/src/features/fiscalization/api
 */

export const fiscalizationQueryKeys = {
  all: ['fiscalization'] as const,
  forOrder: (orderId: string) => ['fiscalization', 'order', orderId] as const,
  /**
   * Where a registration has got to, per (order, connection) - the same pair the
   * exactly-once key is built from, so two connections cannot share a cache
   * entry describing one of them.
   */
  progressForOrder: (orderId: string, connectionId: string) =>
    ['fiscalization', 'order', orderId, 'progress', connectionId] as const,
};
