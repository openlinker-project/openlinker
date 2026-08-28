/**
 * Operational Settings API Client
 *
 * Thin HTTP adapter over the admin-only `/operational-settings` endpoints
 * (#2651). One singleton resource: a read that reports every value with its
 * provenance, and a partial write that answers 204.
 *
 * @module apps/web/src/features/settings/api
 */
import type {
  OperationalSettingsView,
  UpdateOperationalSettingsInput,
} from './operational-settings.types';

export interface OperationalSettingsApi {
  get: () => Promise<OperationalSettingsView>;
  update: (input: UpdateOperationalSettingsInput) => Promise<void>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createOperationalSettingsApi(request: ApiRequest): OperationalSettingsApi {
  return {
    get(): Promise<OperationalSettingsView> {
      return request<OperationalSettingsView>('/operational-settings');
    },
    async update(input): Promise<void> {
      await request<void>('/operational-settings', {
        method: 'PUT',
        body: JSON.stringify(input),
      });
    },
  };
}
