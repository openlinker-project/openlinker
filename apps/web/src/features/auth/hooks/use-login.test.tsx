import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren, ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { SessionProvider } from '../../../shared/auth/session-provider';
import type { SessionAdapter } from '../../../shared/auth/session-adapter';
import { ANONYMOUS_SESSION } from '../../../shared/auth/session.types';
import type { Session } from '../../../shared/auth/session.types';
import { useLogin } from './use-login';

const captureDemoEvent = vi.fn();
vi.mock('../../demo', () => ({
  captureDemoEvent: (...args: unknown[]): unknown => captureDemoEvent(...args),
}));

function createTestAdapter(session: Session = ANONYMOUS_SESSION): SessionAdapter {
  return {
    getSession: vi.fn().mockResolvedValue(session),
    getAccessToken: vi.fn().mockResolvedValue(null),
    persistSession: vi.fn().mockResolvedValue(undefined),
    clearSession: vi.fn().mockResolvedValue(undefined),
  };
}

function createWrapper(
  apiClient: ReturnType<typeof createMockApiClient>,
  sessionAdapter: SessionAdapter,
): ({ children }: PropsWithChildren) => ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

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

describe('useLogin', () => {
  beforeEach(() => {
    captureDemoEvent.mockClear();
  });

  it('should call auth API login and persist session on success', async () => {
    const apiClient = createMockApiClient();
    const adapter = createTestAdapter();
    const { result } = renderHook(() => useLogin(), {
      wrapper: createWrapper(apiClient, adapter),
    });

    await result.current.mutateAsync({ username: 'admin', password: 'secret' });

    expect(apiClient.auth.login).toHaveBeenCalledWith({
      username: 'admin',
      password: 'secret',
    });
    expect(adapter.persistSession).toHaveBeenCalledWith('mock-jwt-token');
  });

  it('should call refreshSession after persisting token', async () => {
    const apiClient = createMockApiClient();
    const adapter = createTestAdapter();
    const { result } = renderHook(() => useLogin(), {
      wrapper: createWrapper(apiClient, adapter),
    });

    await result.current.mutateAsync({ username: 'admin', password: 'secret' });

    // getSession is called once during SessionProvider mount (refreshSession on init),
    // and once more after the login mutation triggers refreshSession
    await waitFor(() => {
      expect(adapter.getSession).toHaveBeenCalledTimes(2);
    });
  });

  it('should fire demo_login_succeeded with the freshly-persisted session role (#1790)', async () => {
    const apiClient = createMockApiClient();
    const adapter = createTestAdapter({
      status: 'authenticated',
      accessToken: 'mock-jwt-token',
      user: {
        id: 'user_1',
        username: 'admin',
        email: 'admin@example.com',
        role: 'admin',
        permissions: [],
      },
    });
    const { result } = renderHook(() => useLogin(), {
      wrapper: createWrapper(apiClient, adapter),
    });

    await result.current.mutateAsync({ username: 'admin', password: 'secret' });

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_login_succeeded', { role: 'admin' });
  });

  it('should surface error on login failure', async () => {
    const apiClient = createMockApiClient({
      auth: {
        login: vi.fn().mockRejectedValue(new Error('Invalid credentials')),
      },
    });
    const adapter = createTestAdapter();
    const { result } = renderHook(() => useLogin(), {
      wrapper: createWrapper(apiClient, adapter),
    });

    await expect(
      result.current.mutateAsync({ username: 'admin', password: 'wrong' }),
    ).rejects.toThrow('Invalid credentials');

    expect(adapter.persistSession).not.toHaveBeenCalled();
  });
});
