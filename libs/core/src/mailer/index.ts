/**
 * Mailer Module Public API
 *
 * Exports domain entities, ports, types, application service interfaces,
 * and the NestJS module for the mailer bounded context (DB-backed
 * mailer/SMTP settings — #1643, mirrors the AI Provider Settings pattern).
 *
 * @module libs/core/src/mailer
 */
export {
  MailerSettings,
  MAILER_SETTINGS_SINGLETON_ID,
} from './domain/entities/mailer-settings.entity';
export type { MailerSettingsRepositoryPort } from './domain/ports/mailer-settings-repository.port';
export { MailerTransportValues } from './domain/types/mailer-settings.types';
export type {
  MailerTransport,
  MailerSettingsInput,
  MailerSettingsView,
  ResolvedMailerTransportConfig,
} from './domain/types/mailer-settings.types';
export { MAILER_SMTP_CREDENTIALS_REF } from './domain/types/mailer-credentials.types';
export type { IMailerSettingsService } from './application/services/mailer-settings.service.interface';
export { MailerModule } from './mailer.module';
export * from './mailer.tokens';
