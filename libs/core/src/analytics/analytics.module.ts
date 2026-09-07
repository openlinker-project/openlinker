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
 * Also wires the singleton `analytics_display_settings` repository and
 * `AnalyticsDisplaySettingsService` (#2461, epic #2452 Phase 3) — the
 * display-currency override, rate-recomputation basis, and
 * backfilled-tax-rate Net Sales inclusion opt-in consumed by the `/analytics`
 * dashboard. Placed in this context rather than `orders` or `currency`
 * because it is exactly the same shape as the sibling `posthog_settings` row
 * already owned here (an analytics-feature operator preference), while
 * `orders` has an unrelated order-lifecycle responsibility and `currency` is
 * a documented leaf scoped to FX stamping.
 *
 * Also wires the `analytics_remediation_runs` audit ledger (#2468, epic
 * #2452 Phase 5) — the durable record that an operator asked for a Data
 * Coverage repair and how it ended. Currency-category-only by design (the tax
 * side is a query-time settings toggle with nothing to track); placed here
 * for the same reason the display settings are, and because the ledger row is
 * what makes the ADR-040 stamp restatement it authorises auditable.
 *
 * @module libs/core/src/analytics
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsModule as CoreIntegrationsModule } from '@openlinker/core/integrations';
import {
  ANALYTICS_DISPLAY_SETTINGS_REPOSITORY_TOKEN,
  ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN,
  ANALYTICS_REMEDIATION_RUN_REPOSITORY_TOKEN,
  ANALYTICS_REMEDIATION_RUN_SERVICE_TOKEN,
  POSTHOG_SETTINGS_REPOSITORY_TOKEN,
  POSTHOG_SETTINGS_SERVICE_TOKEN,
} from './analytics.tokens';
import { AnalyticsDisplaySettingsService } from './application/services/analytics-display-settings.service';
import { AnalyticsRemediationRunService } from './application/services/analytics-remediation-run.service';
import { PosthogSettingsService } from './application/services/posthog-settings.service';
import { AnalyticsDisplaySettingsOrmEntity } from './infrastructure/persistence/entities/analytics-display-settings.orm-entity';
import { AnalyticsRemediationRunOrmEntity } from './infrastructure/persistence/entities/analytics-remediation-run.orm-entity';
import { PosthogSettingsOrmEntity } from './infrastructure/persistence/entities/posthog-settings.orm-entity';
import { AnalyticsDisplaySettingsRepository } from './infrastructure/persistence/repositories/analytics-display-settings.repository';
import { AnalyticsRemediationRunRepository } from './infrastructure/persistence/repositories/analytics-remediation-run.repository';
import { PosthogSettingsRepository } from './infrastructure/persistence/repositories/posthog-settings.repository';

@Module({
  imports: [
    ConfigModule,
    // For CREDENTIALS_SERVICE_TOKEN, consumed by PosthogSettingsService to
    // store/resolve the API key.
    CoreIntegrationsModule,
    TypeOrmModule.forFeature([
      PosthogSettingsOrmEntity,
      AnalyticsDisplaySettingsOrmEntity,
      AnalyticsRemediationRunOrmEntity,
    ]),
  ],
  providers: [
    PosthogSettingsRepository,
    { provide: POSTHOG_SETTINGS_REPOSITORY_TOKEN, useExisting: PosthogSettingsRepository },
    PosthogSettingsService,
    { provide: POSTHOG_SETTINGS_SERVICE_TOKEN, useExisting: PosthogSettingsService },
    AnalyticsDisplaySettingsRepository,
    {
      provide: ANALYTICS_DISPLAY_SETTINGS_REPOSITORY_TOKEN,
      useExisting: AnalyticsDisplaySettingsRepository,
    },
    AnalyticsDisplaySettingsService,
    {
      provide: ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN,
      useExisting: AnalyticsDisplaySettingsService,
    },
    AnalyticsRemediationRunRepository,
    {
      provide: ANALYTICS_REMEDIATION_RUN_REPOSITORY_TOKEN,
      useExisting: AnalyticsRemediationRunRepository,
    },
    AnalyticsRemediationRunService,
    {
      provide: ANALYTICS_REMEDIATION_RUN_SERVICE_TOKEN,
      useExisting: AnalyticsRemediationRunService,
    },
  ],
  exports: [
    POSTHOG_SETTINGS_REPOSITORY_TOKEN,
    POSTHOG_SETTINGS_SERVICE_TOKEN,
    ANALYTICS_DISPLAY_SETTINGS_REPOSITORY_TOKEN,
    ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN,
    ANALYTICS_REMEDIATION_RUN_REPOSITORY_TOKEN,
    ANALYTICS_REMEDIATION_RUN_SERVICE_TOKEN,
  ],
})
export class AnalyticsModule {}
