/**
 * Mailer Credentials Types
 *
 * The SMTP password is stored as a single credential row in the shared,
 * encrypted `integration_credentials` store (via `ICredentialsService`,
 * `@openlinker/core/integrations`) rather than as a plaintext column on
 * `mailer_settings`. Single fixed `ref` — unlike the AI provider keys there
 * is only one mailer transport active at a time, so no per-provider
 * parameterization is needed.
 *
 * @module libs/core/src/mailer/domain/types
 */

export const MAILER_SMTP_CREDENTIALS_REF = 'mailer:smtp-password';
