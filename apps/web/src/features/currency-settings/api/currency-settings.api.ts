/**
 * Currency Settings API Client
 *
 * Thin HTTP adapter over the admin-only `/currency-settings` endpoints.
 *
 * @module apps/web/src/features/currency-settings/api
 */
import type { CurrencySettingsView, SetReportingCurrencyInput } from './currency-settings.types';

export interface CurrencySettingsApi {
  get: () => Promise<CurrencySettingsView>;
  setReportingCurrency: (input: SetReportingCurrencyInput) => Promise<void>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createCurrencySettingsApi(request: ApiRequest): CurrencySettingsApi {
  return {
    get(): Promise<CurrencySettingsView> {
      return request<CurrencySettingsView>('/currency-settings');
    },
    async setReportingCurrency(input): Promise<void> {
      await request<void>('/currency-settings/reporting-currency', {
        method: 'PUT',
        body: JSON.stringify(input),
      });
    },
  };
}
