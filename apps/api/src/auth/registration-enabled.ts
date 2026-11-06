/**
 * Registration Enabled Flag
 *
 * The one reading of `OL_REGISTRATION_ENABLED` (default false). Shared by
 * `RegistrationService`, which refuses a sign-up, and `SystemService`, which
 * tells the browser whether to offer one (#4028) - so the two cannot disagree.
 *
 * @module apps/api/src/auth
 */
export const REGISTRATION_ENABLED_ENV_VAR = 'OL_REGISTRATION_ENABLED';

export function isRegistrationEnabled(readEnv: (name: string) => string | undefined): boolean {
  return (readEnv(REGISTRATION_ENABLED_ENV_VAR) ?? 'false').trim().toLowerCase() === 'true';
}
