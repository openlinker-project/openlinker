/**
 * Mailer Settings — Query Key Factory
 *
 * Singular resource (one row server-side) so `current()` is the only key.
 * The `all` key is the invalidation root used by mutation hooks.
 *
 * @module apps/web/src/features/mailer-settings/api
 */

export const mailerSettingsQueryKeys = {
  all: ['mailer-settings'] as const,
  current: () => ['mailer-settings', 'current'] as const,
};
