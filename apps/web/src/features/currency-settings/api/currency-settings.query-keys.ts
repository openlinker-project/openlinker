/**
 * Currency Settings — Query Key Factory
 *
 * Singular resource (one setting row server-side) so `current()` is the
 * only key. The `all` key is the invalidation root used by the mutation hook.
 *
 * @module apps/web/src/features/currency-settings/api
 */

export const currencySettingsQueryKeys = {
  all: ['currency-settings'] as const,
  current: () => ['currency-settings', 'current'] as const,
};
