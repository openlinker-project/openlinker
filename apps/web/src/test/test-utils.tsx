import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { ApiClient } from '../app/api/api-client';
import { ApiClientProvider } from '../app/api/api-client-provider';
import type { Connection } from '../features/connections/api/connections.types';
import { createNoopSessionAdapter } from '../shared/auth/noop-session-adapter';
import { SessionProvider } from '../shared/auth/session-provider';
import { ToastProvider } from '../shared/ui/toast-provider';

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  apiClient?: ApiClient;
  route?: string;
}

const sampleConnection: Connection = {
  id: 'conn_1',
  name: 'Main PrestaShop Store',
  platformType: 'prestashop',
  status: 'active',
  config: {
    baseUrl: 'https://example.com',
  },
  credentialsRef: 'db:cred_1',
  adapterKey: 'prestashop.webservice.v1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

export function createMockApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    request: vi.fn(),
    adapters: {
      list: vi.fn().mockResolvedValue([]),
      ...overrides.adapters,
    },
    allegro: {
      startOAuth: vi.fn().mockResolvedValue({
        authorizationUrl: 'https://example.com/oauth',
        state: 'state',
      }),
      ...overrides.allegro,
    },
    connections: {
      create: vi.fn().mockResolvedValue(sampleConnection),
      getById: vi.fn().mockResolvedValue(sampleConnection),
      list: vi.fn().mockResolvedValue([sampleConnection]),
      update: vi.fn().mockResolvedValue(sampleConnection),
      ...overrides.connections,
    },
    syncJobs: {
      enqueue: vi.fn().mockResolvedValue({
        jobId: 'job_1',
        status: 'queued',
      }),
      ...overrides.syncJobs,
    },
    ...overrides,
  };
}

export function renderWithProviders(ui: ReactElement, options: RenderWithProvidersOptions = {}): RenderResult {
  const { apiClient = createMockApiClient(), route = '/', ...renderOptions } = options;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  window.history.pushState({}, 'Test', route);

  return render(ui, {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={[route]}>
        <SessionProvider adapter={createNoopSessionAdapter()}>
          <ToastProvider>
            <ApiClientProvider client={apiClient}>
              <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
            </ApiClientProvider>
          </ToastProvider>
        </SessionProvider>
      </MemoryRouter>
    ),
    ...renderOptions,
  });
}
