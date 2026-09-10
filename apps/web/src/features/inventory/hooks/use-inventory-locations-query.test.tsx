import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { useInventoryLocationsQuery } from './use-inventory-locations-query';
import type { PaginatedInventoryLocations } from '../api/inventory-locations.types';

function createWrapper(
  apiClient: ReturnType<typeof createMockApiClient>,
): ({ children }: PropsWithChildren) => ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <ApiClientProvider client={apiClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    );
  };
}

const page: PaginatedInventoryLocations = {
  items: [],
  total: 0,
  page: 1,
  limit: 25,
};

describe('useInventoryLocationsQuery', () => {
  it('should forward filters and pagination to the api client', async () => {
    const listLocations = vi.fn().mockResolvedValue(page);
    const apiClient = createMockApiClient({ inventory: { listLocations } });

    const { result } = renderHook(
      () => useInventoryLocationsQuery({ kind: 'warehouse', status: 'active' }, { page: 2, limit: 10 }),
      { wrapper: createWrapper(apiClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(listLocations).toHaveBeenCalledWith(
      { kind: 'warehouse', status: 'active' },
      { page: 2, limit: 10 },
    );
    expect(result.current.data).toEqual(page);
  });

  it('should surface an error when the request rejects', async () => {
    const apiClient = createMockApiClient({
      inventory: { listLocations: vi.fn().mockRejectedValue(new Error('Network error')) },
    });

    const { result } = renderHook(() => useInventoryLocationsQuery(), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });
});
