/**
 * Mailer Settings Domain Entity
 *
 * Singleton-row representation of the DB-backed mailer/SMTP settings
 * (transport, host, port, secure, from address). Modeled on
 * `AiProviderActiveSetting` — the SMTP password is intentionally NOT a
 * field here; it lives in the encrypted `integration_credentials` store at
 * `ref = 'mailer:smtp-password'` and is resolved separately by
 * `MailerSettingsService`.
 *
 * @module libs/core/src/mailer/domain/entities
 */
import type { MailerTransport } from '../types/mailer-settings.types';

export const MAILER_SETTINGS_SINGLETON_ID = 'singleton';

export class MailerSettings {
  constructor(
    public readonly transport: MailerTransport,
    public readonly smtpHost: string | null,
    public readonly smtpPort: number | null,
    public readonly smtpSecure: boolean,
    public readonly fromAddress: string | null,
    public readonly updatedAt: Date,
    public readonly updatedBy: string | null
  ) {}
}
