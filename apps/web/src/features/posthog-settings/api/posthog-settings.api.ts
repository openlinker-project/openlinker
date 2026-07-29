/**
 * PostHog Settings API Client
 *
 * Thin HTTP adapter over the admin-only `/posthog-settings` endpoints. The
 * API key is write-only — `setCredentials` / `clearCredentials` never
 * receive or return the actual key value.
 *
 * @module apps/web/src/features/posthog-settings/api
 */
import type {
  PosthogSettingsView,
  SetPosthogCredentialsInput,
  UpdatePosthogSettingsInput,
} from './posthog-settings.types';

export interface PosthogSettingsApi {
  get: () => Promise<PosthogSettingsView>;
  update: (input: UpdatePosthogSettingsInput) => Promise<void>;
  setCredentials: (input: SetPosthogCredentialsInput) => Promise<void>;
  clearCredentials: () => Promise<void>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createPosthogSettingsApi(request: ApiRequest): PosthogSettingsApi {
  return {
    get(): Promise<PosthogSettingsView> {
      return request<PosthogSettingsView>('/posthog-settings');
    },
    async update(input): Promise<void> {
      await request<void>('/posthog-settings', {
        method: 'PUT',
        body: JSON.stringify(input),
      });
    },
    async setCredentials(input): Promise<void> {
      await request<void>('/posthog-settings/credentials', {
        method: 'PUT',
        body: JSON.stringify(input),
      });
    },
    async clearCredentials(): Promise<void> {
      await request<void>('/posthog-settings/credentials', { method: 'DELETE' });
    },
  };
}
