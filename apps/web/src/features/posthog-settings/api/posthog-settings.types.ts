/**
 * PostHog Settings — Frontend Types
 *
 * Hand-written wire types mirroring the backend DTOs in
 * `apps/api/src/analytics/http/dto/*.ts`. Kept FE-local so the web bundle
 * stays independent of NestJS / core imports.
 *
 * @module apps/web/src/features/posthog-settings/api
 */

export const PosthogRegionValues = ['eu', 'us', 'custom'] as const;
export type PosthogRegion = (typeof PosthogRegionValues)[number];

/**
 * Response shape for `GET /posthog-settings`. Never includes the API key —
 * only whether one is currently configured (DB or env) — and never
 * includes raw env var values, only which ones a saved row would shadow.
 */
export interface PosthogSettingsView {
  enabled: boolean;
  region: PosthogRegion;
  customHost: string | null;
  autocapture: boolean;
  sessionRecording: boolean;
  apiKeyConfigured: boolean;
  wouldOverrideEnv: boolean;
  overriddenEnvVars: string[];
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Body for `PUT /posthog-settings`. The API key is written separately. */
export interface UpdatePosthogSettingsInput {
  enabled: boolean;
  region: PosthogRegion;
  customHost: string | null;
  autocapture: boolean;
  sessionRecording: boolean;
}

/** Body for `PUT /posthog-settings/credentials`. Server trims `apiKey`. */
export interface SetPosthogCredentialsInput {
  apiKey: string;
}
