import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState, type PropsWithChildren } from 'react';
import { createApiClient } from '../api/api-client';
import { ApiClientProvider } from '../api/api-client-provider';
import { createNoopSessionAdapter } from '../../shared/auth/noop-session-adapter';
import { SessionProvider } from '../../shared/auth/session-provider';
import { env } from '../../shared/config/env';

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 30_000,
          },
        },
      }),
  );
  const sessionAdapter = useMemo(() => createNoopSessionAdapter(), []);
  const apiClient = useMemo(
    () =>
      createApiClient({
        baseUrl: env.VITE_API_BASE_URL,
        sessionAdapter,
      }),
    [sessionAdapter],
  );

  return (
    <SessionProvider adapter={sessionAdapter}>
      <ApiClientProvider client={apiClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    </SessionProvider>
  );
}
