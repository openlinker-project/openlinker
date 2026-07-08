/**
 * PostHog Config Types
 *
 * Value shape returned by `IPosthogConfigService.getConfig()`.
 *
 * @module apps/api/src/system
 */

export interface PosthogConfig {
  key: string;
  host: string;
}
