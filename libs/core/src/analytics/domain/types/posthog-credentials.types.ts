/**
 * PostHog Credentials Types
 *
 * The PostHog project API key is stored as a single credential row in the
 * shared, encrypted `integration_credentials` store (via `ICredentialsService`,
 * `@openlinker/core/integrations`) rather than as a plaintext column on
 * `posthog_settings`. Single fixed `ref` — mirrors
 * `MAILER_SMTP_CREDENTIALS_REF` (only one PostHog project is active at a
 * time, so no per-provider parameterization is needed).
 *
 * @module libs/core/src/analytics/domain/types
 */

export const POSTHOG_API_KEY_CREDENTIALS_REF = 'posthog:api-key';
