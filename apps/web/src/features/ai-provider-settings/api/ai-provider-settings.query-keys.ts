/**
 * AI Provider Settings — Query Key Factory
 *
 * Singular resource (one row server-side) so `current()` is the only key.
 * The `all` key is the invalidation root used by mutation hooks.
 *
 * @module apps/web/src/features/ai-provider-settings/api
 */

export const aiProviderSettingsQueryKeys = {
  all: ['ai-provider-settings'] as const,
  current: () => ['ai-provider-settings', 'current'] as const,
};
