/**
 * AI Provider Settings API Client
 *
 * Thin HTTP adapter over the admin-only `/ai-provider-settings` endpoints.
 * Multi-provider surface — `getAll()` returns the composite view used by
 * the provider table; `setKey` / `clearKey` are scoped per provider; and
 * `setActive` switches which provider routes future completions.
 *
 * @module apps/web/src/features/ai-provider-settings/api
 */
import type {
  AiProvider,
  AiProviderSettingsView,
  SetActiveAiProviderInput,
  UpdateAiProviderKeyInput,
} from './ai-provider-settings.types';

export interface AiProviderSettingsApi {
  getAll: () => Promise<AiProviderSettingsView>;
  setKey: (provider: AiProvider, input: UpdateAiProviderKeyInput) => Promise<void>;
  clearKey: (provider: AiProvider) => Promise<void>;
  setActive: (input: SetActiveAiProviderInput) => Promise<void>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createAiProviderSettingsApi(request: ApiRequest): AiProviderSettingsApi {
  return {
    getAll(): Promise<AiProviderSettingsView> {
      return request<AiProviderSettingsView>('/ai-provider-settings');
    },
    async setKey(provider, input): Promise<void> {
      await request<void>(`/ai-provider-settings/keys/${provider}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
    },
    async clearKey(provider): Promise<void> {
      await request<void>(`/ai-provider-settings/keys/${provider}`, { method: 'DELETE' });
    },
    async setActive(input): Promise<void> {
      await request<void>('/ai-provider-settings/active', {
        method: 'PUT',
        body: JSON.stringify(input),
      });
    },
  };
}
