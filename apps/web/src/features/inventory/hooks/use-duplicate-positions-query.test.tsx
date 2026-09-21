/**
 * useDuplicatePositionsQuery tests (#3072)
 *
 * Covers the forwarding of `maxGroups` to the API client, the query-key
 * axis, that the hook surfaces an error rather than swallowing it, and the
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
import { useDuplicatePositionsQuery } from './use-duplicate-positions-query';
import type { DuplicatePositionsReport } from '../api/inventory.types';

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

const report: DuplicatePositionsReport = {
  groupCount: 0,
  rowCount: 0,
  excessRowCount: 0,
  groups: [],
  truncated: false,
  generatedAt: '2026-01-01T00:00:00.000Z',
};

describe('useDuplicatePositionsQuery', () => {
  it('should forward maxGroups to the api client', async () => {
    const getDuplicatePositions = vi.fn().mockResolvedValue(report);
    const apiClient = createMockApiClient({ inventory: { getDuplicatePositions } });

    const { result } = renderHook(() => useDuplicatePositionsQuery(25), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getDuplicatePositions).toHaveBeenCalledWith(25);
    expect(result.current.data).toEqual(report);
  });

  it('should call the api client with undefined when maxGroups is omitted', async () => {
    const getDuplicatePositions = vi.fn().mockResolvedValue(report);
    const apiClient = createMockApiClient({ inventory: { getDuplicatePositions } });

    const { result } = renderHook(() => useDuplicatePositionsQuery(), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getDuplicatePositions).toHaveBeenCalledWith(undefined);
  });

  it('should surface an error when the request rejects', async () => {
    const apiClient = createMockApiClient({
      inventory: { getDuplicatePositions: vi.fn().mockRejectedValue(new Error('Network error')) },
    });

    const { result } = renderHook(() => useDuplicatePositionsQuery(), {
      wrapper: createWrapper(apiClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });

  it('should never call the api client for a non-admin session (#3252 review)', async () => {
    const getDuplicatePositions = vi.fn().mockResolvedValue(report);
    const apiClient = createMockApiClient({ inventory: { getDuplicatePositions } });
    const nonAdminAdapter = createAuthenticatedSessionAdapter({
      id: 'user_2',
      username: 'operator',
      email: 'operator@example.com',
      role: 'operator',
      permissions: [],
      analyticsConsent: true,
    });

    const { result } = renderHook(
      () => ({ query: useDuplicatePositionsQuery(), session: useSession() }),
      { wrapper: createWrapper(apiClient, nonAdminAdapter) }
    );

    // `SessionProvider` starts anonymous and hydrates asynchronously; wait
    // for the real (non-admin) session to settle before asserting, or the
    // "never called" assertion would pass vacuously before `enabled` was
    // ever evaluated against it.
    await waitFor(() => expect(result.current.session.isReady).toBe(true));

    expect(result.current.query.fetchStatus).toBe('idle');
    expect(getDuplicatePositions).not.toHaveBeenCalled();
  });
});
