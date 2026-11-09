/**
 * Login Page Settings Query Keys
 *
 * @module features/login-page-settings/api
 */
export const loginPageSettingsQueryKeys = {
  all: ['login-page-settings'] as const,
  current: () => ['login-page-settings', 'current'] as const,
};
