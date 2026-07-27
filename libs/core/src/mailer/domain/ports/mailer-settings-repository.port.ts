/**
 * Mailer Settings Repository Port
 *
 * Persistence contract for the singleton-row `mailer_settings` table.
 * Implemented by `MailerSettingsRepository` in the infrastructure layer;
 * consumed by `MailerSettingsService`. Mirrors
 * `AiProviderActiveSettingRepositoryPort`.
 *
 * @module libs/core/src/mailer/domain/ports
 */
import type { MailerSettings } from '../entities/mailer-settings.entity';
import type { MailerSettingsInput } from '../types/mailer-settings.types';

export interface MailerSettingsRepositoryPort {
  /**
   * Read the singleton row. Returns `null` when no row exists yet — callers
   * are expected to fall back to env-var resolution and create the row on
   * first admin write.
   */
  findSettings(): Promise<MailerSettings | null>;

  /**
   * Idempotently upsert the non-secret settings fields on the singleton row.
   * Creates the row if absent.
   */
  upsertSettings(input: MailerSettingsInput, updatedBy: string | null): Promise<MailerSettings>;
}
