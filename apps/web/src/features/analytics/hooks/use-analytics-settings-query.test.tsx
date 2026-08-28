import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { useAnalyticsSettingsQuery } from './use-analytics-settings-query';
import type { AnalyticsSettingsView } from '../api/analytics-settings.types';

function createWrapper(
  apiClient: ReturnType<typeof createMockApiClient>
): ({ children }: PropsWithChildren) => ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <ApiClientProvider client={apiClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    );
  };
}

const mockSettings: AnalyticsSettingsView = {
  displayCurrency: 'PLN',
  displayCurrencySource: 'setting',
  rateBasis: 'order-date',
  includeBackfilledTaxRatesInNetSales: true,
  updatedAt: '2026-08-01T00:00:00.000Z',
  updatedByUserId: 'user_1',
};

describe('useAnalyticsSettingsQuery', () => {
  it('should return the settings view on success', async () => {
    const apiClient = createMockApiClient({
      analyticsSettings: { getSettings: vi.fn().mockResolvedValue(mockSettings) },
    });

    const { result } = renderHook(() => useAnalyticsSettingsQuery(), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockSettings);
    expect(apiClient.analyticsSettings.getSettings).toHaveBeenCalledTimes(1);
  });

  it('should report isLoading before the request resolves', () => {
    const apiClient = createMockApiClient({
      analyticsSettings: {
        getSettings: vi.fn(() => new Promise<AnalyticsSettingsView>(() => {})),
      },
    });

    const { result } = renderHook(() => useAnalyticsSettingsQuery(), {
      wrapper: createWrapper(apiClient),
    });

    expect(result.current.isLoading).toBe(true);
  });

  it('should surface an error when the request rejects', async () => {
    const apiClient = createMockApiClient({
      analyticsSettings: { getSettings: vi.fn().mockRejectedValue(new Error('Network error')) },
    });

    const { result } = renderHook(() => useAnalyticsSettingsQuery(), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });
});
