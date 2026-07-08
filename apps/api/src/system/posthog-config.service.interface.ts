/**
 * PostHog Config Service Interface
 *
 * Contract for reading the demo instance's PostHog analytics configuration
 * from the environment. Consumed by the system config endpoint to surface
 * a demo-only, vendor-neutral integration seam (see ADR-032).
 *
 * @module apps/api/src/system
 */

export interface PosthogConfig {
  key: string;
  host: string;
}

export interface IPosthogConfigService {
  /**
   * Returns the configured PostHog key/host, or `null` when OL_POSTHOG_KEY
   * is unset — the caller (SystemService) is responsible for also gating
   * on demo mode before exposing this to the frontend.
   */
  getConfig(): PosthogConfig | null;
}

export const POSTHOG_CONFIG_SERVICE_TOKEN = Symbol('IPosthogConfigService');
