/**
 * Automatic shipping labels - query keys (#2729)
 *
 * @module apps/web/src/features/auto-dispatch/api
 */
export const autoDispatchQueryKeys = {
  all: ['auto-dispatch'] as const,
  refusals: (connectionId: string) =>
    [...autoDispatchQueryKeys.all, 'refusals', connectionId] as const,
};
