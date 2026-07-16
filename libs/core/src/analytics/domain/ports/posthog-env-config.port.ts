/**
 * PostHog Env Config Port
 *
 * Inversion seam so `PosthogSettingsService` (this context, `libs/core`) can
 * fall back to the legacy env-var-only PostHog config without depending on
 * `apps/api/src/system/posthog-config.service.ts`, which lives at the app
 * layer, not in core. The existing `PosthogConfigService` implements this
 * port with zero behavior change; the concrete binding is supplied by the
 * host (`SystemModule`), not by this module.
 *
 * @module libs/core/src/analytics/domain/ports
 */

export interface PosthogEnvConfig {
  key: string;
  host: string;
  /**
   * True when `OL_POSTHOG_HOST` was explicitly set in the environment
   * (as opposed to defaulted). Lets `PosthogSettingsService` name the exact
   * env var(s) a saved DB row would shadow, without ever exposing the env
   * value itself.
   */
  hostWasExplicit: boolean;
}

export interface PosthogEnvConfigPort {
  /**
   * Returns the configured PostHog key/host from the environment, or `null`
   * when `OL_POSTHOG_KEY` is unset.
   */
  getConfig(): PosthogEnvConfig | null;
}
