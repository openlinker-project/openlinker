/**
 * Fulfilment-task query keys (#2411)
 *
 * @module apps/web/src/features/fulfillment/api
 */
export const fulfillmentQueryKeys = {
  all: ['fulfillment'] as const,
  worksByOrder: (orderId: string) => ['fulfillment', 'works', 'by-order', orderId] as const,
};
