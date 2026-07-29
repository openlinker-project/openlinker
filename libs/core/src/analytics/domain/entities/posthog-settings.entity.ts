/**
 * PostHog Settings Domain Entity
 *
 * Singleton-row representation of the DB-backed PostHog analytics settings
 * (enabled, region, custom host, autocapture, session recording). Modeled on
 * `MailerSettings` — the API key is intentionally NOT a field here; it lives
 * in the encrypted `integration_credentials` store at
 * `ref = 'posthog:api-key'` and is resolved separately by
 * `PosthogSettingsService`.
 *
 * @module libs/core/src/analytics/domain/entities
 */
import type { PosthogRegion } from '../types/posthog-settings.types';

export const POSTHOG_SETTINGS_SINGLETON_ID = 'singleton';

export class PosthogSettings {
  constructor(
    public readonly enabled: boolean,
    public readonly region: PosthogRegion,
    public readonly customHost: string | null,
    public readonly autocapture: boolean,
    public readonly sessionRecording: boolean,
    public readonly productEventsEnabled: boolean,
    public readonly enabledEventGroups: string[],
    public readonly updatedAt: Date,
    public readonly updatedBy: string | null
  ) {}
}
