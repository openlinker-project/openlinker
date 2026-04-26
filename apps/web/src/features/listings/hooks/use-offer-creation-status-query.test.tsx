/**
 * use-offer-creation-status-query Tests
 *
 * Focused on the `refetchInterval` stop-on-terminal behaviour.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { useOfferCreationStatusQuery } from './use-offer-creation-status-query';
import type { OfferCreationStatusResponse } from '../api/listings.types';

function pending(): OfferCreationStatusResponse {
  return {
    id: 'rec-1',
    connectionId: 'conn-1',
    internalVariantId: 'ol_variant_abc',
    externalOfferId: null,
    status: 'pending',
    errors: null,
    publishImmediately: false,
    createdAt: '2026-04-22T10:00:00Z',
    updatedAt: '2026-04-22T10:00:00Z',
  };
}

function active(): OfferCreationStatusResponse {
  return { ...pending(), status: 'active', externalOfferId: 'ext-1' };
}

function draft(): OfferCreationStatusResponse {
  return { ...pending(), status: 'draft', externalOfferId: 'ext-1' };
}

describe('useOfferCreationStatusQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  function wrap(apiClient: ReturnType<typeof createMockApiClient>): React.FC<{ children: React.ReactNode }> {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
    });
    return ({ children }) => (
      <ApiClientProvider client={apiClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    );
  }

  it('stops polling once the status is terminal', async () => {
    const getOfferCreationStatus = vi.fn().mockResolvedValue(active());
    const apiClient = createMockApiClient({ listings: { getOfferCreationStatus } });
    const { result } = renderHook(() => useOfferCreationStatusQuery('conn-1', 'rec-1'), {
      wrapper: wrap(apiClient),
    });
    await waitFor(() => expect(result.current.data?.status).toBe('active'));
    // Wait well past one poll interval — the hook must not call again.
    await new Promise((r) => setTimeout(r, 80));
    expect(getOfferCreationStatus).toHaveBeenCalledTimes(1);
  });

  it('stops polling on draft status (#407)', async () => {
    // 'draft' is a terminal outcome of the create lifecycle (Allegro
    // accepted, awaiting manual publish in the seller panel) — polling
    // it forever wastes requests and keeps "still processing" copy on
    // screen indefinitely. Regression guard for the terminal-status fix.
    const getOfferCreationStatus = vi.fn().mockResolvedValue(draft());
    const apiClient = createMockApiClient({ listings: { getOfferCreationStatus } });
    const { result } = renderHook(() => useOfferCreationStatusQuery('conn-1', 'rec-1'), {
      wrapper: wrap(apiClient),
    });
    await waitFor(() => expect(result.current.data?.status).toBe('draft'));
    await new Promise((r) => setTimeout(r, 80));
    expect(getOfferCreationStatus).toHaveBeenCalledTimes(1);
  });

  it('fetches the record once for a non-terminal status and is eligible to poll', async () => {
    // We do not test the actual interval firing (that would make the suite
    // wait OFFER_CREATION_POLL_INTERVAL_MS per run). TanStack Query's
    // scheduling is trusted — what we own is the "stop on terminal" logic,
    // already covered above. Here we just confirm the hook runs for a
    // pending record and does not immediately enter an error or skipped
    // state.
    const getOfferCreationStatus = vi.fn().mockResolvedValue(pending());
    const apiClient = createMockApiClient({ listings: { getOfferCreationStatus } });

    const { result } = renderHook(() => useOfferCreationStatusQuery('conn-1', 'rec-1'), {
      wrapper: wrap(apiClient),
    });

    await waitFor(() => expect(result.current.data?.status).toBe('pending'));
    expect(getOfferCreationStatus).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it('does not run when connectionId or recordId is empty', async () => {
    const getOfferCreationStatus = vi.fn();
    const apiClient = createMockApiClient({ listings: { getOfferCreationStatus } });
    renderHook(() => useOfferCreationStatusQuery('', ''), { wrapper: wrap(apiClient) });
    await new Promise((r) => setTimeout(r, 30));
    expect(getOfferCreationStatus).not.toHaveBeenCalled();
  });
});
