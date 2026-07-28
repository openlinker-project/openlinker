import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { SessionProvider } from '../../../shared/auth/session-provider';
import type { SessionAdapter } from '../../../shared/auth/session-adapter';
import type { Session } from '../../../shared/auth/session.types';
import type { ApiClient } from '../../../app/api/api-client';
import { createMockApiClient } from '../../../test/test-utils';
import { useUpdateAnalyticsConsentMutation } from './use-update-analytics-consent-mutation';

const authenticated = (analyticsConsent: boolean): Session => ({
  status: 'authenticated',
  accessToken: 'test-jwt-token',
  user: {
    id: 'user_2',
    username: 'demo_user',
    email: 'demo@example.com',
    role: 'viewer',
    permissions: [],
    analyticsConsent,
  },
});

/**
 * Adapter that flips its reported consent after the first re-read, so a test
 * can tell "the hook refreshed the session" apart from "the hook assumed".
 */
function createCountingAdapter(): { adapter: SessionAdapter; getSessionCalls: () => number } {
  let calls = 0;
  return {
    getSessionCalls: () => calls,
    adapter: {
      async getSession(): Promise<Session> {
        calls += 1;
        return authenticated(calls > 1);
      },
      async getAccessToken(): Promise<string> {
        return 'test-jwt-token';
      },
      async persistSession(): Promise<void> {},
      async clearSession(): Promise<void> {},
    },
  };
}

function wrapper(
  apiClient: ApiClient,
  adapter: SessionAdapter,
): (props: { children: ReactNode }) => ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <SessionProvider adapter={adapter}>
        <ApiClientProvider client={apiClient}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </ApiClientProvider>
      </SessionProvider>
    );
  };
}

describe('useUpdateAnalyticsConsentMutation (#1882)', () => {
  it('should call the consent endpoint with the requested value', async () => {
    const updateAnalyticsConsent = vi.fn().mockResolvedValue(authenticated(true).user);
    const apiClient = createMockApiClient({ auth: { updateAnalyticsConsent } });
    const { adapter } = createCountingAdapter();

    const { result } = renderHook(() => useUpdateAnalyticsConsentMutation(), {
      wrapper: wrapper(apiClient, adapter),
    });

    await result.current.mutateAsync({ analyticsConsent: true });

    expect(updateAnalyticsConsent).toHaveBeenCalledWith({ analyticsConsent: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('should re-read the session so the JWT-backed consent is not assumed', async () => {
    const apiClient = createMockApiClient({
      auth: { updateAnalyticsConsent: vi.fn().mockResolvedValue(authenticated(true).user) },
    });
    const { adapter, getSessionCalls } = createCountingAdapter();

    const { result } = renderHook(() => useUpdateAnalyticsConsentMutation(), {
      wrapper: wrapper(apiClient, adapter),
    });

    await waitFor(() => expect(getSessionCalls()).toBe(1));
    await result.current.mutateAsync({ analyticsConsent: true });

    await waitFor(() => expect(getSessionCalls()).toBeGreaterThan(1));
  });

  it('should surface the failure to the caller when the endpoint rejects', async () => {
    const apiClient = createMockApiClient({
      auth: { updateAnalyticsConsent: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    const { adapter } = createCountingAdapter();

    const { result } = renderHook(() => useUpdateAnalyticsConsentMutation(), {
      wrapper: wrapper(apiClient, adapter),
    });

    await expect(result.current.mutateAsync({ analyticsConsent: true })).rejects.toThrow('boom');
  });
});
