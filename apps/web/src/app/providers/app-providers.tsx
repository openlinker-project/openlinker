import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState, type PropsWithChildren, type ReactElement } from 'react';
import { createApiClient } from '../api/api-client';
import { ApiClientProvider } from '../api/api-client-provider';
import { createJwtBearerSessionAdapter } from '../../shared/auth/jwt-bearer-session-adapter';
import { SessionProvider } from '../../shared/auth/session-provider';
import { ToastProvider } from '../../shared/ui/toast-provider';
import { env } from '../../shared/config/env';
import { ThemeProvider } from '../../shared/theme';
import { PluginRegistryProvider } from '../../shared/plugins';
import { IN_TREE_PLUGINS } from '../../plugins';

export function AppProviders({ children }: PropsWithChildren): ReactElement {
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
  const sessionAdapter = useMemo(
    () => createJwtBearerSessionAdapter({ baseUrl: env.VITE_API_BASE_URL }),
    [],
  );
  const apiClient = useMemo(
    () =>
      createApiClient({
        baseUrl: env.VITE_API_BASE_URL,
        sessionAdapter,
      }),
    [sessionAdapter],
  );

  return (
    <ThemeProvider>
      <PluginRegistryProvider plugins={IN_TREE_PLUGINS}>
        <SessionProvider adapter={sessionAdapter}>
          <ToastProvider>
            <ApiClientProvider client={apiClient}>
              <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
            </ApiClientProvider>
          </ToastProvider>
        </SessionProvider>
      </PluginRegistryProvider>
    </ThemeProvider>
  );
}
