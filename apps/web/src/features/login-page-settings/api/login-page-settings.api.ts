/**
 * Login Page Settings API
 *
 * @module features/login-page-settings/api
 */
import type { ApiRequest } from '../../../app/api/api-client';
import type {
  LoginPageSettingsView,
  UpdateLoginPageSettingsInput,
} from './login-page-settings.types';

export interface LoginPageSettingsApi {
  get: () => Promise<LoginPageSettingsView>;
  update: (input: UpdateLoginPageSettingsInput) => Promise<void>;
}

export function createLoginPageSettingsApi(request: ApiRequest): LoginPageSettingsApi {
  return {
    get(): Promise<LoginPageSettingsView> {
      return request<LoginPageSettingsView>('/login-page-settings');
    },
    async update(input): Promise<void> {
      await request<void>('/login-page-settings', { method: 'PUT', body: JSON.stringify(input) });
    },
  };
}
