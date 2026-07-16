/**
 * PostHog Settings Service Interface
 *
 * Contract for the DB-backed PostHog analytics settings service. Mirrors
 * `IMailerSettingsService`'s shape one-for-one.
 *
 * @module libs/core/src/analytics/application/services
 */
import type { PosthogSettingsInput, PosthogSettingsView, ResolvedPosthogConfig } from '../../domain/types/posthog-settings.types';

export interface IPosthogSettingsService {
  /** Read the current settings (never returns the raw API key). */
  getSettings(): Promise<PosthogSettingsView>;

  /** Update the non-secret settings fields. */
  updateSettings(input: PosthogSettingsInput, actorUserId?: string): Promise<void>;

  /** Set or rotate the PostHog project API key. */
  setApiKey(apiKey: string, actorUserId?: string): Promise<void>;

  /** Clear the stored API key (falls back to env or none). */
  clearApiKey(actorUserId?: string): Promise<void>;

  /**
   * Resolve the effective runtime PostHog configuration: an enabled DB row
   * takes priority; otherwise falls back to env vars. Returns `null` when
   * neither resolves to a usable key.
   */
  resolveConfig(): Promise<ResolvedPosthogConfig | null>;
}
