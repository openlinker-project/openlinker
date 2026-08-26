/**
 * Who-Decides Query Keys
 *
 * @module apps/web/src/features/fulfillment-authority/api
 */
export const whoDecidesQueryKeys = {
  all: ['fulfillment-authority'] as const,
  status: () => [...whoDecidesQueryKeys.all, 'status'] as const,
};
