/**
 * Release state query keys
 *
 * @module features/release-center/api
 */
export const releaseStateQueryKeys = {
  all: ['release-state'] as const,
  state: () => ['release-state', 'state'] as const,
};
