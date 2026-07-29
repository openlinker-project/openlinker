/**
 * PostHog Settings Types
 *
 * Value types for the DB-backed PostHog analytics settings (#1685). `region`
 * is a closed 3-value union — PostHog's two public cloud regions plus
 * self-hosted — chosen deliberately over a free-text host string: a real
 * incident (key on US cloud, host defaulting to EU) was caught only by
 * manual testing, since PostHog's `/capture` endpoint always returns
 * `200 Ok` regardless of key validity. A region picker with a derived host
 * makes that mismatch far harder to create by accident.
 *
 * @module libs/core/src/analytics/domain/types
 */

export const PosthogRegionValues = ['eu', 'us', 'custom'] as const;
export type PosthogRegion = (typeof PosthogRegionValues)[number];

/**
 * Non-secret settings fields, as written by `PUT /posthog-settings`. The API
 * key is deliberately absent — it is written separately via
 * `PUT /posthog-settings/credentials` into the encrypted credentials store.
 */
export interface PosthogSettingsInput {
  enabled: boolean;
  region: PosthogRegion;
  /** Only meaningful when `region === 'custom'`; ignored otherwise. */
  customHost: string | null;
  autocapture: boolean;
  sessionRecording: boolean;
  /**
   * Master toggle for demo-mode product events (#1787), independent of
   * `autocapture` — an operator can run session recording without product
   * events, or vice versa.
   */
  productEventsEnabled: boolean;
  /**
   * Enabled `DemoEventGroup` values (opaque strings here — the closed enum
   * lives in the `apps/web` demo-events catalog, which core cannot import).
   * An event whose group is absent from this list is a no-op regardless of
   * `productEventsEnabled`.
   */
  enabledEventGroups: string[];
}

/**
 * Read view returned by `GET /posthog-settings`. Never carries the API key —
 * only whether one is currently configured (DB or env) — and never carries
 * raw env var values, only which ones would be shadowed by the saved row.
 */
export interface PosthogSettingsView extends PosthogSettingsInput {
  apiKeyConfigured: boolean;
  /** True when an enabled DB row would take priority over a set env var. */
  wouldOverrideEnv: boolean;
  /** Names of the env vars shadowed, e.g. `['OL_POSTHOG_KEY']`. Never values. */
  overriddenEnvVars: string[];
  updatedAt: Date | null;
  updatedBy: string | null;
}

/**
 * Fully-resolved runtime PostHog configuration consumed by `SystemService`
 * to populate `GET /v1/system/config`'s `demoIntegrations.posthog`.
 * Resolution order: enabled DB row → env var fallback (see
 * `IPosthogSettingsService.resolveConfig`).
 */
export interface ResolvedPosthogConfig {
  key: string;
  host: string;
  autocapture: boolean;
  sessionRecording: boolean;
  productEventsEnabled: boolean;
  enabledEventGroups: string[];
}
