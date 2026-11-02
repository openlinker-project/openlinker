import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { inventoryQueryKeys } from '../../inventory';
import { useUpdateOperationalSettingsMutation } from './use-update-operational-settings-mutation';

function setup(): { queryClient: QueryClient; wrapper: ({ children }: PropsWithChildren) => ReactElement } {
  const apiClient = createMockApiClient({
    operationalSettings: { update: vi.fn().mockResolvedValue(undefined) },
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(inventoryQueryKeys.stockView('p1'), { variants: [] });
  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <ApiClientProvider client={apiClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useUpdateOperationalSettingsMutation', () => {
  it('should invalidate the stock view when the stale threshold is saved', async () => {
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useUpdateOperationalSettingsMutation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ stockStaleSyncThresholdHours: 12 });
    });
    await waitFor(() =>
      expect(queryClient.getQueryState(inventoryQueryKeys.stockView('p1'))?.isInvalidated).toBe(true),
    );
  });

  it('should leave the stock view alone for an unrelated setting', async () => {
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useUpdateOperationalSettingsMutation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ sweepPageSize: 100 });
    });
    expect(queryClient.getQueryState(inventoryQueryKeys.stockView('p1'))?.isInvalidated).toBe(false);
  });
});
