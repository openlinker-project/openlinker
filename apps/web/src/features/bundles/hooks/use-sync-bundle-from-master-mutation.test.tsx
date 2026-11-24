/**
 * Syncing a bundle from its master writes a new version, which can release
 * orders held on the older composition, so the order reads refresh too (#3520).
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSyncBundleFromMasterMutation } from './use-sync-bundle-from-master-mutation';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';

describe('useSyncBundleFromMasterMutation (#3520)', () => {
  it('should invalidate the orders reads after a sync', async () => {
    const bundles = { syncFromMaster: vi.fn().mockResolvedValue({ variantId: 'v', version: 2, components: [] }) };
    const apiClient = createMockApiClient({ bundles });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useSyncBundleFromMasterMutation(), { wrapper });

    result.current.mutate('v');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders'] });
  });
});
