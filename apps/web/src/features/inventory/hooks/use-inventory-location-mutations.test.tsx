/**
 * Covers the invalidation behaviour shared by the three write hooks
 * (create/update/delete): every one of them has to move BOTH a filtered list
 * entry and the unrelated `activeLocations` count, which is why they all
 * invalidate the `locationsAll()` prefix rather than their own narrow key —
 * see the docblock on each hook. This test pins that prefix actually clears
 * a real cached query, rather than asserting the mock was called with the
 * right array (which would pass even if the prefix did not match anything).
 */
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import { useCreateInventoryLocationMutation } from './use-create-inventory-location-mutation';
import { useUpdateInventoryLocationMutation } from './use-update-inventory-location-mutation';
import { useDeleteInventoryLocationMutation } from './use-delete-inventory-location-mutation';
import type { InventoryLocation } from '../api/inventory-locations.types';

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

function createWrapper(
  apiClient: ReturnType<typeof createMockApiClient>,
  queryClient: QueryClient,
): ({ children }: PropsWithChildren) => ReactElement {
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <ApiClientProvider client={apiClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    );
  };
}

/** Renders both the mutation-under-test and a sibling read against every
 * locations-registry key, so a real cache invalidation is observable. */
function renderWithSiblingReads(
  apiClient: ReturnType<typeof createMockApiClient>,
  useMutationHook: () => { mutate: (input: never) => void },
): {
  activeCalls: () => number;
  listCalls: () => number;
  detailCalls: () => number;
  mutate: (input: never) => void;
} {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = createWrapper(apiClient, queryClient);

  renderHook(
    () => useQuery({ queryKey: inventoryQueryKeys.activeLocations(), queryFn: () => Promise.resolve(1) }),
    { wrapper },
  );
  renderHook(
    () =>
      useQuery({
        queryKey: inventoryQueryKeys.locations(),
        queryFn: () => Promise.resolve({ items: [], total: 0, page: 1, limit: 25 }),
      }),
    { wrapper },
  );
  renderHook(
    () =>
      useQuery({
        queryKey: inventoryQueryKeys.locationDetail('ol_location_1'),
        queryFn: () => Promise.resolve(row),
      }),
    { wrapper },
  );
  const mutation = renderHook(() => useMutationHook(), { wrapper });

  return {
    activeCalls: () => queryClient.getQueryState(inventoryQueryKeys.activeLocations())?.dataUpdateCount ?? 0,
    listCalls: () => queryClient.getQueryState(inventoryQueryKeys.locations())?.dataUpdateCount ?? 0,
    detailCalls: () =>
      queryClient.getQueryState(inventoryQueryKeys.locationDetail('ol_location_1'))?.dataUpdateCount ?? 0,
    mutate: mutation.result.current.mutate,
  };
}

describe('locations mutation invalidation', () => {
  it('create should refresh the active-count, list and detail caches', async () => {
    const createLocation = vi.fn().mockResolvedValue(row);
    const apiClient = createMockApiClient({ inventory: { createLocation } });
    const { activeCalls, listCalls, detailCalls, mutate } = renderWithSiblingReads(apiClient, () =>
      useCreateInventoryLocationMutation(),
    );

    await waitFor(() => expect(activeCalls()).toBe(1));
    await waitFor(() => expect(listCalls()).toBe(1));
    await waitFor(() => expect(detailCalls()).toBe(1));

    act(() => mutate({ code: 'WH2', name: 'Overflow', kind: 'warehouse' } as never));

    await waitFor(() => expect(createLocation).toHaveBeenCalled());
    await waitFor(() => expect(activeCalls()).toBe(2));
    await waitFor(() => expect(listCalls()).toBe(2));
    await waitFor(() => expect(detailCalls()).toBe(2));
  });

  it('update should refresh the active-count, list and detail caches', async () => {
    const updateLocation = vi.fn().mockResolvedValue(row);
    const apiClient = createMockApiClient({ inventory: { updateLocation } });
    const { activeCalls, listCalls, detailCalls, mutate } = renderWithSiblingReads(apiClient, () =>
      useUpdateInventoryLocationMutation(),
    );

    await waitFor(() => expect(activeCalls()).toBe(1));

    act(() => mutate({ id: 'ol_location_1', patch: { status: 'inactive' } } as never));

    await waitFor(() => expect(updateLocation).toHaveBeenCalledWith('ol_location_1', { status: 'inactive' }));
    await waitFor(() => expect(activeCalls()).toBe(2));
    await waitFor(() => expect(listCalls()).toBe(2));
    await waitFor(() => expect(detailCalls()).toBe(2));
  });

  it('delete should refresh the active-count, list and detail caches', async () => {
    const deleteLocation = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ inventory: { deleteLocation } });
    const { activeCalls, listCalls, detailCalls, mutate } = renderWithSiblingReads(apiClient, () =>
      useDeleteInventoryLocationMutation(),
    );

    await waitFor(() => expect(activeCalls()).toBe(1));

    act(() => mutate('ol_location_1' as never));

    await waitFor(() => expect(deleteLocation).toHaveBeenCalledWith('ol_location_1'));
    await waitFor(() => expect(activeCalls()).toBe(2));
    await waitFor(() => expect(listCalls()).toBe(2));
    await waitFor(() => expect(detailCalls()).toBe(2));
  });
});
