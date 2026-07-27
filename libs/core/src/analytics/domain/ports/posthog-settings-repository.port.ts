/**
 * PostHog Settings Repository Port
 *
 * Persistence contract for the singleton-row `posthog_settings` table.
 * Implemented by `PosthogSettingsRepository` in the infrastructure layer;
 * consumed by `PosthogSettingsService`. Mirrors `MailerSettingsRepositoryPort`.
 *
 * @module libs/core/src/analytics/domain/ports
 */
import type { PosthogSettings } from '../entities/posthog-settings.entity';
import type { PosthogSettingsInput } from '../types/posthog-settings.types';

export interface PosthogSettingsRepositoryPort {
  /**
   * Read the singleton row. Returns `null` when no row exists yet — callers
   * are expected to fall back to env-var resolution.
   */
  findSettings(): Promise<PosthogSettings | null>;

  /**
   * Idempotently upsert the non-secret settings fields on the singleton row.
   * Creates the row if absent.
   */
  upsertSettings(input: PosthogSettingsInput, updatedBy: string | null): Promise<PosthogSettings>;
}
