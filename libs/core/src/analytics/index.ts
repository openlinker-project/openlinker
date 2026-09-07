/**
 * Analytics Module Public API
 *
 * Exports domain entities, ports, types, application service interfaces,
 * and the NestJS module for the analytics bounded context (DB-backed
 * PostHog settings — #1685, mirrors the Mailer Settings pattern).
 *
 * @module libs/core/src/analytics
 */
export {
  PosthogSettings,
  POSTHOG_SETTINGS_SINGLETON_ID,
} from './domain/entities/posthog-settings.entity';
export type { PosthogSettingsRepositoryPort } from './domain/ports/posthog-settings-repository.port';
export { PosthogRegionValues } from './domain/types/posthog-settings.types';
export type {
  PosthogRegion,
  PosthogSettingsInput,
  PosthogSettingsView,
  ResolvedPosthogConfig,
} from './domain/types/posthog-settings.types';
export { POSTHOG_API_KEY_CREDENTIALS_REF } from './domain/types/posthog-credentials.types';
export type { IPosthogSettingsService } from './application/services/posthog-settings.service.interface';
export {
  AnalyticsDisplaySettings,
  ANALYTICS_DISPLAY_SETTINGS_SINGLETON_ID,
} from './domain/entities/analytics-display-settings.entity';
export type { AnalyticsDisplaySettingsRepositoryPort } from './domain/ports/analytics-display-settings-repository.port';
export { RateBasisValues, NetGrossBasisValues } from './domain/types/analytics-display-settings.types';
export type {
  RateBasis,
  NetGrossBasis,
  AnalyticsDisplaySettingsInput,
  AnalyticsDisplaySettingsView,
} from './domain/types/analytics-display-settings.types';
export type { IAnalyticsDisplaySettingsService } from './application/services/analytics-display-settings.service.interface';
export { AnalyticsRemediationRun } from './domain/entities/analytics-remediation-run.entity';
export { OpenRemediationRunExistsError } from './domain/exceptions/open-remediation-run-exists.error';
export type { AnalyticsRemediationRunRepositoryPort } from './domain/ports/analytics-remediation-run-repository.port';
export {
  ANALYTICS_REMEDIATION_RUN_ID_PREFIX,
  CURRENCY_REMEDIATION_CATEGORY,
  OPEN_REMEDIATION_RUN_STATUSES,
} from './domain/types/analytics-remediation-run.types';
export type {
  AnalyticsRemediationRunInput,
  AnalyticsRemediationRunView,
} from './domain/types/analytics-remediation-run.types';
export type { IAnalyticsRemediationRunService } from './application/services/analytics-remediation-run.service.interface';
export { AnalyticsModule } from './analytics.module';
export * from './analytics.tokens';
