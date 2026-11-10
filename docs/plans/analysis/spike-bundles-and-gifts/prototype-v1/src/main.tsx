import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@web/index.css';
import './proto.css';
import { LocaleProvider } from '@web/shared/i18n/locale-provider';
import { ToastProvider } from '@web/shared/ui/toast-provider';
import { TooltipProvider } from '@web/shared/ui/tooltip';
import { ApiClientProvider } from '@web/app/api/api-client-provider';
import type { ApiClient } from '@web/app/api/api-client';
import { App } from './App';

// The app's dark theme keys on html[data-theme]; follow the OS until the viewer chooses.
function syncTheme(): void {
  const root = document.documentElement;
  if (root.dataset.themeExplicit === '1') return;
  const explicit = root.getAttribute('data-theme');
  if (explicit === 'dark' || explicit === 'light') {
    root.dataset.themeExplicit = '1';
    return;
  }
  root.setAttribute('data-theme', window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
syncTheme();

/** A prototype has no backend: every API call rejects, so components fall back to their placeholders. */
const offlineClient = new Proxy(
  {},
  { get: () => () => Promise.reject(new Error('Prototyp nie ma backendu')) },
) as unknown as ApiClient;

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
});

const el = document.getElementById('spike-root');
if (el) {
  createRoot(el).render(
    <LocaleProvider locale="pl">
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={offlineClient}>
          <MemoryRouter>
            <TooltipProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </TooltipProvider>
          </MemoryRouter>
        </ApiClientProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}
