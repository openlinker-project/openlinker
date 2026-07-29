/**
 * Mailer Settings API Client
 *
 * Thin HTTP adapter over the admin-only `/mailer-settings` endpoints. The
 * SMTP password is write-only — `setCredentials` / `clearCredentials` never
 * receive or return the actual password value.
 *
 * @module apps/web/src/features/mailer-settings/api
 */
import type {
  MailerSettingsView,
  SetMailerCredentialsInput,
  UpdateMailerSettingsInput,
} from './mailer-settings.types';

export interface MailerSettingsApi {
  get: () => Promise<MailerSettingsView>;
  update: (input: UpdateMailerSettingsInput) => Promise<void>;
  setCredentials: (input: SetMailerCredentialsInput) => Promise<void>;
  clearCredentials: () => Promise<void>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createMailerSettingsApi(request: ApiRequest): MailerSettingsApi {
  return {
    get(): Promise<MailerSettingsView> {
      return request<MailerSettingsView>('/mailer-settings');
    },
    async update(input): Promise<void> {
      await request<void>('/mailer-settings', {
        method: 'PUT',
        body: JSON.stringify(input),
      });
    },
    async setCredentials(input): Promise<void> {
      await request<void>('/mailer-settings/credentials', {
        method: 'PUT',
        body: JSON.stringify(input),
      });
    },
    async clearCredentials(): Promise<void> {
      await request<void>('/mailer-settings/credentials', { method: 'DELETE' });
    },
  };
}
