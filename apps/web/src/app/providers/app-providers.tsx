import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState, type PropsWithChildren, type ReactElement } from 'react';
import { createApiClient } from '../api/api-client';
import { ApiClientProvider } from '../api/api-client-provider';
import { createJwtBearerSessionAdapter } from '../../shared/auth/jwt-bearer-session-adapter';
import { SessionProvider } from '../../shared/auth/session-provider';
import { ToastProvider } from '../../shared/ui/toast-provider';
import { TooltipProvider } from '../../shared/ui/tooltip';
import { env } from '../../shared/config/env';
import { isAnalyticsConsentRequiredError } from '../../shared/api/analytics-consent-error';
import { ThemeProvider } from '../../shared/theme';
import { LocaleProvider } from '../../shared/i18n';
import { PluginRegistryProvider } from '../../shared/plugins';
import { plugins } from '../../plugins';

const CONSENT_PATH = '/consent';

/**
 * Route a consent-required 403 (#1938) to the consent page. Handled here, once,
 * rather than per query: any call can be the one that trips the API's global
 * guard — typically in a tab left open since before consent became mandatory.
 *
 * A hard navigation rather than a router push, because the QueryClient is
 * created above the router and has no navigate to call. The full reload is also
 * useful: booting fresh re-mints the access token, so a merely stale claim
 * resolves without the visitor doing anything.
 */
function redirectToConsentPage(error: unknown): void {
  if (!isAnalyticsConsentRequiredError(error)) {
    return;
  }
  if (window.location.pathname === CONSENT_PATH) {
    return;
  }
  const next = encodeURIComponent(window.location.pathname);
  window.location.assign(`${CONSENT_PATH}?next=${next}`);
}

export function AppProviders({ children }: PropsWithChildren): ReactElement {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: redirectToConsentPage }),
        mutationCache: new MutationCache({ onError: redirectToConsentPage }),
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
      <LocaleProvider>
        <PluginRegistryProvider plugins={plugins}>
          <SessionProvider adapter={sessionAdapter}>
            <ToastProvider>
              <TooltipProvider>
                <ApiClientProvider client={apiClient}>
                  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
                </ApiClientProvider>
              </TooltipProvider>
            </ToastProvider>
          </SessionProvider>
        </PluginRegistryProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
