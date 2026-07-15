/**
 * Mailer Module (core)
 *
 * NestJS module for the mailer bounded context. Wires the singleton
 * `mailer_settings` repository and `MailerSettingsService`, which resolves
 * the effective outbound-email transport configuration (console vs SMTP)
 * at runtime: DB row → env var fallback → console default. The SMTP
 * password is stored via the shared encrypted `integration_credentials`
 * store (`CoreIntegrationsModule`), not on this module's own table.
 *
 * The concrete `MailerPort` adapter (console/SMTP transport + nodemailer)
 * lives in `apps/api/src/auth/adapters/` — this module only owns settings
 * persistence + resolution, mirroring how `AiModule` owns AI provider
 * settings while the Vercel completion adapters live in
 * `libs/integrations/ai/`.
 *
 * @module libs/core/src/mailer
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsModule as CoreIntegrationsModule } from '../integrations/integrations.module';
import { MAILER_SETTINGS_REPOSITORY_TOKEN, MAILER_SETTINGS_SERVICE_TOKEN } from './mailer.tokens';
import { MailerSettingsService } from './application/services/mailer-settings.service';
import { MailerSettingsOrmEntity } from './infrastructure/persistence/entities/mailer-settings.orm-entity';
import { MailerSettingsRepository } from './infrastructure/persistence/repositories/mailer-settings.repository';

@Module({
  imports: [
    ConfigModule,
    // For CREDENTIALS_SERVICE_TOKEN, consumed by MailerSettingsService to
    // store/resolve the SMTP password.
    CoreIntegrationsModule,
    TypeOrmModule.forFeature([MailerSettingsOrmEntity]),
  ],
  providers: [
    MailerSettingsRepository,
    { provide: MAILER_SETTINGS_REPOSITORY_TOKEN, useExisting: MailerSettingsRepository },
    MailerSettingsService,
    { provide: MAILER_SETTINGS_SERVICE_TOKEN, useExisting: MailerSettingsService },
  ],
  exports: [MAILER_SETTINGS_REPOSITORY_TOKEN, MAILER_SETTINGS_SERVICE_TOKEN],
})
export class MailerModule {}
