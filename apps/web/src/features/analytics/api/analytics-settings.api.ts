/**
 * Analytics Settings API client
 *
 * Thin request module for `GET`/`PUT /analytics/settings` (#2461, epic #2452
 * Phase 6, #2471) — the display-currency override, rate-recomputation basis,
 * and the backfilled-tax-rate Net Sales inclusion opt-in.
 *
 * `GET` is open to any authenticated user (every operator reads the display
 * preference in effect); `PUT` is admin-only server-side.
 *
 * @module features/analytics/api
 */
import type { AnalyticsSettingsView, UpdateAnalyticsSettingsInput } from './analytics-settings.types';

export interface AnalyticsSettingsApi {
  getSettings: () => Promise<AnalyticsSettingsView>;
  updateSettings: (input: UpdateAnalyticsSettingsInput) => Promise<void>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createAnalyticsSettingsApi(request: ApiRequest): AnalyticsSettingsApi {
  return {
    getSettings: () => request<AnalyticsSettingsView>('/analytics/settings'),
    async updateSettings(input): Promise<void> {
      await request<void>('/analytics/settings', {
        method: 'PUT',
        body: JSON.stringify(input),
      });
    },
  };
}
