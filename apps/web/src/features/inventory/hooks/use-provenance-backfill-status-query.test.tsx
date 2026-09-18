/**
 * useProvenanceBackfillStatusQuery tests (#3072)
 *
 * Covers the axis-free query key, the `latchedAt` field round-tripping
 * through the hook, that a rejected request surfaces as an error, and the
 * `enabled: isAdmin` admin gate the hook added (#3252 review) — a non-admin
 * session must never trigger a 403 round-trip.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { SessionProvider } from '../../../shared/auth/session-provider';
import { useSession } from '../../../shared/auth/use-session';
import type { SessionAdapter } from '../../../shared/auth/session-adapter';
import { createAuthenticatedSessionAdapter, createMockApiClient } from '../../../test/test-utils';
import { useProvenanceBackfillStatusQuery } from './use-provenance-backfill-status-query';
import type { ProvenanceBackfillStatus } from '../api/inventory.types';

function createWrapper(
  apiClient: ReturnType<typeof createMockApiClient>,
  sessionAdapter: SessionAdapter = createAuthenticatedSessionAdapter(),
): ({ children }: PropsWithChildren) => ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <SessionProvider adapter={sessionAdapter}>
        <ApiClientProvider client={apiClient}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </ApiClientProvider>
      </SessionProvider>
    );
  };
}

describe('useProvenanceBackfillStatusQuery', () => {
  it('should call the api client with no arguments', async () => {
    const status: ProvenanceBackfillStatus = { remainingNull: 0, completed: true, latchedAt: null };
    const getProvenanceBackfillStatus = vi.fn().mockResolvedValue(status);
    const apiClient = createMockApiClient({ inventory: { getProvenanceBackfillStatus } });

    const { result } = renderHook(() => useProvenanceBackfillStatusQuery(), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getProvenanceBackfillStatus).toHaveBeenCalledWith();
    expect(result.current.data).toEqual(status);
  });

  it('should surface a latched, still-draining status untouched', async () => {
    const status: ProvenanceBackfillStatus = {
      remainingNull: 37,
      completed: false,
      latchedAt: '2026-08-01T00:00:00.000Z',
    };
    const apiClient = createMockApiClient({
      inventory: { getProvenanceBackfillStatus: vi.fn().mockResolvedValue(status) },
    });

    const { result } = renderHook(() => useProvenanceBackfillStatusQuery(), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.latchedAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('should surface an error when the request rejects', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getProvenanceBackfillStatus: vi.fn().mockRejectedValue(new Error('Network error')),
      },
    });

    const { result } = renderHook(() => useProvenanceBackfillStatusQuery(), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });

  it('should never call the api client for a non-admin session (#3252 review)', async () => {
    const getProvenanceBackfillStatus = vi.fn().mockResolvedValue({
      remainingNull: 0,
      completed: true,
      latchedAt: null,
    } satisfies ProvenanceBackfillStatus);
    const apiClient = createMockApiClient({ inventory: { getProvenanceBackfillStatus } });
    const nonAdminAdapter = createAuthenticatedSessionAdapter({
      id: 'user_2',
      username: 'operator',
      email: 'operator@example.com',
      role: 'operator',
      permissions: [],
      analyticsConsent: true,
    });

    const { result } = renderHook(
      () => ({ query: useProvenanceBackfillStatusQuery(), session: useSession() }),
      { wrapper: createWrapper(apiClient, nonAdminAdapter) }
    );

    // `SessionProvider` starts anonymous and hydrates asynchronously; wait
    // for the real (non-admin) session to settle before asserting, or the
    // "never called" assertion would pass vacuously before `enabled` was
    // ever evaluated against it.
    await waitFor(() => expect(result.current.session.isReady).toBe(true));

    expect(result.current.query.fetchStatus).toBe('idle');
    expect(getProvenanceBackfillStatus).not.toHaveBeenCalled();
  });
});
