import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { analyticsSettingsQueryKeys } from '../api/analytics-settings.query-keys';
import { useUpdateAnalyticsSettingsMutation } from './use-update-analytics-settings-mutation';

function createWrapper(
  apiClient: ReturnType<typeof createMockApiClient>,
  queryClient: QueryClient
): ({ children }: PropsWithChildren) => ReactElement {
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <ApiClientProvider client={apiClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    );
  };
}

describe('useUpdateAnalyticsSettingsMutation', () => {
  it('should call the update endpoint with the requested settings', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ analyticsSettings: { updateSettings } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useUpdateAnalyticsSettingsMutation(), {
      wrapper: createWrapper(apiClient, queryClient),
    });

    await result.current.mutateAsync({
      displayCurrency: 'PLN',
      rateBasis: 'current',
      includeBackfilledTaxRatesInNetSales: true,
      netGrossBasis: 'gross',
    });

    expect(updateSettings).toHaveBeenCalledWith({
      displayCurrency: 'PLN',
      rateBasis: 'current',
      includeBackfilledTaxRatesInNetSales: true,
      netGrossBasis: 'gross',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('should invalidate the settings query on success', async () => {
    const apiClient = createMockApiClient({
      analyticsSettings: { updateSettings: vi.fn().mockResolvedValue(undefined) },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateAnalyticsSettingsMutation(), {
      wrapper: createWrapper(apiClient, queryClient),
    });

    await result.current.mutateAsync({
      displayCurrency: null,
      rateBasis: 'order-date',
      includeBackfilledTaxRatesInNetSales: false,
      netGrossBasis: 'gross',
    });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: analyticsSettingsQueryKeys.all })
    );
  });

  it('should surface the failure to the caller when the endpoint rejects', async () => {
    const apiClient = createMockApiClient({
      analyticsSettings: { updateSettings: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useUpdateAnalyticsSettingsMutation(), {
      wrapper: createWrapper(apiClient, queryClient),
    });

    await expect(
      result.current.mutateAsync({
        displayCurrency: 'PLN',
        rateBasis: 'current',
        includeBackfilledTaxRatesInNetSales: false,
        netGrossBasis: 'gross',
      })
    ).rejects.toThrow('boom');
  });
});
