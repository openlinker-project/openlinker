/**
 * AI Provider Settings API Client
 *
 * Thin HTTP adapter over the admin-only `/ai-provider-settings` endpoints
 * shipped in #402. Instantiated by `createApiClient()` and consumed
 * through `useApiClient().aiProviderSettings`.
 *
 * @module apps/web/src/features/ai-provider-settings/api
 */
import type {
  AiProviderSettingsView,
  UpdateAiProviderSettingsInput,
} from './ai-provider-settings.types';

export interface AiProviderSettingsApi {
  get: () => Promise<AiProviderSettingsView>;
  update: (input: UpdateAiProviderSettingsInput) => Promise<void>;
  clear: () => Promise<void>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createAiProviderSettingsApi(request: ApiRequest): AiProviderSettingsApi {
  return {
    get(): Promise<AiProviderSettingsView> {
      return request<AiProviderSettingsView>('/ai-provider-settings');
    },
    async update(input): Promise<void> {
      await request<void>('/ai-provider-settings', {
        method: 'PUT',
        body: JSON.stringify(input),
      });
    },
    async clear(): Promise<void> {
      await request<void>('/ai-provider-settings', { method: 'DELETE' });
    },
  };
}
