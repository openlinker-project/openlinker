import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { useInventoryLocationQuery } from './use-inventory-location-query';
import type { InventoryLocation } from '../api/inventory-locations.types';

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

const row: InventoryLocation = {
  id: 'ol_location_1',
  code: 'WH1',
  name: 'Main warehouse',
  kind: 'warehouse',
  ownerConnectionId: null,
  externalRef: null,
  status: 'active',
  countryIso2: null,
  postcode: null,
  latitude: null,
  longitude: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('useInventoryLocationQuery', () => {
  it('should fetch the location by id', async () => {
    const getLocation = vi.fn().mockResolvedValue(row);
    const apiClient = createMockApiClient({ inventory: { getLocation } });

    const { result } = renderHook(() => useInventoryLocationQuery('ol_location_1'), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getLocation).toHaveBeenCalledWith('ol_location_1');
    expect(result.current.data).toEqual(row);
  });

  it('should not fetch when the id is empty', () => {
    const getLocation = vi.fn().mockResolvedValue(row);
    const apiClient = createMockApiClient({ inventory: { getLocation } });

    renderHook(() => useInventoryLocationQuery(''), { wrapper: createWrapper(apiClient) });

    expect(getLocation).not.toHaveBeenCalled();
  });

  it('should not fetch when the caller disables it', () => {
    const getLocation = vi.fn().mockResolvedValue(row);
    const apiClient = createMockApiClient({ inventory: { getLocation } });

    renderHook(() => useInventoryLocationQuery('ol_location_1', { enabled: false }), {
      wrapper: createWrapper(apiClient),
    });

    expect(getLocation).not.toHaveBeenCalled();
  });
});
