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
export { AnalyticsModule } from './analytics.module';
export * from './analytics.tokens';
