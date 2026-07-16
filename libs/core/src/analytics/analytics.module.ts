/**
 * Analytics Module (core)
 *
 * NestJS module for the analytics bounded context. Wires the singleton
 * `posthog_settings` repository and `PosthogSettingsService`, which resolves
 * the effective PostHog analytics configuration at runtime: enabled DB row →
 * env var fallback → none. The PostHog API key is stored via the shared
 * encrypted `integration_credentials` store (`CoreIntegrationsModule`), not
 * on this module's own table.
 *
 * `PosthogSettingsService` reads the `OL_POSTHOG_KEY`/`OL_POSTHOG_HOST` env
 * fallback directly via `ConfigService` (globally registered by the host's
 * `ConfigModule.forRoot({ isGlobal: true })`) — mirroring exactly how
 * `MailerSettingsService` reads `MAIL_*` env vars. No host-supplied port
 * binding is needed for this module to be self-contained.
 *
 * @module libs/core/src/analytics
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsModule as CoreIntegrationsModule } from '@openlinker/core/integrations';
import { POSTHOG_SETTINGS_REPOSITORY_TOKEN, POSTHOG_SETTINGS_SERVICE_TOKEN } from './analytics.tokens';
import { PosthogSettingsService } from './application/services/posthog-settings.service';
import { PosthogSettingsOrmEntity } from './infrastructure/persistence/entities/posthog-settings.orm-entity';
import { PosthogSettingsRepository } from './infrastructure/persistence/repositories/posthog-settings.repository';

@Module({
  imports: [
    ConfigModule,
    // For CREDENTIALS_SERVICE_TOKEN, consumed by PosthogSettingsService to
    // store/resolve the API key.
    CoreIntegrationsModule,
    TypeOrmModule.forFeature([PosthogSettingsOrmEntity]),
  ],
  providers: [
    PosthogSettingsRepository,
    { provide: POSTHOG_SETTINGS_REPOSITORY_TOKEN, useExisting: PosthogSettingsRepository },
    PosthogSettingsService,
    { provide: POSTHOG_SETTINGS_SERVICE_TOKEN, useExisting: PosthogSettingsService },
  ],
  exports: [POSTHOG_SETTINGS_REPOSITORY_TOKEN, POSTHOG_SETTINGS_SERVICE_TOKEN],
})
export class AnalyticsModule {}
