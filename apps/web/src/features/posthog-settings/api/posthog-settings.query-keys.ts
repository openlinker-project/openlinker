/**
 * PostHog Settings — Query Key Factory
 *
 * Singular resource (one row server-side) so `current()` is the only key.
 * The `all` key is the invalidation root used by mutation hooks.
 *
 * @module apps/web/src/features/posthog-settings/api
 */

export const posthogSettingsQueryKeys = {
  all: ['posthog-settings'] as const,
  current: () => ['posthog-settings', 'current'] as const,
};
