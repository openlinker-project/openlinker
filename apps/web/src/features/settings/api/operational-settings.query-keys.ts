/**
 * Operational Settings — Query Key Factory
 *
 * Singular resource (one row server-side) so `current()` is the only key.
 * `all` is the invalidation root the mutation hook uses.
 *
 * @module apps/web/src/features/settings/api
 */

export const operationalSettingsQueryKeys = {
  all: ['operational-settings'] as const,
  current: () => ['operational-settings', 'current'] as const,
};
