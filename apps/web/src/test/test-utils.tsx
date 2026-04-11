import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { ApiClient } from '../app/api/api-client';
import { ApiClientProvider } from '../app/api/api-client-provider';
import type { Connection } from '../features/connections/api/connections.types';
import { createNoopSessionAdapter } from '../shared/auth/noop-session-adapter';
import type { SessionAdapter } from '../shared/auth/session-adapter';
import { SessionProvider } from '../shared/auth/session-provider';
import type { Session, SessionUser } from '../shared/auth/session.types';
import { ToastProvider } from '../shared/ui/toast-provider';

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  apiClient?: ApiClient;
  route?: string;
  sessionAdapter?: SessionAdapter;
}

export const sampleConnection: Connection = {
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

type DeepPartialApiClient = {
  request?: ApiClient['request'];
  adapters?: Partial<ApiClient['adapters']>;
  allegro?: Partial<ApiClient['allegro']>;
  auth?: Partial<ApiClient['auth']>;
  connections?: Partial<ApiClient['connections']>;
  health?: Partial<ApiClient['health']>;
  inventory?: Partial<ApiClient['inventory']>;
  orders?: Partial<ApiClient['orders']>;
  products?: Partial<ApiClient['products']>;
  syncJobs?: Partial<ApiClient['syncJobs']>;
};

export function createMockApiClient(overrides: DeepPartialApiClient = {}): ApiClient {
  return {
    request: overrides.request ?? vi.fn(),
    adapters: {
      list: vi.fn().mockResolvedValue([]),
      ...overrides.adapters,
    } as ApiClient['adapters'],
    allegro: {
      startOAuth: vi.fn().mockResolvedValue({
        authorizationUrl: 'https://example.com/oauth',
        state: 'state',
      }),
      handleCallback: vi.fn().mockResolvedValue({
        message: 'OAuth callback processed successfully. Connection created.',
        connectionId: 'conn_allegro_1',
        connectionName: 'Allegro sandbox',
      }),
      ...overrides.allegro,
    } as ApiClient['allegro'],
    auth: {
      login: vi.fn().mockResolvedValue({ access_token: 'mock-jwt-token' }),
      ...overrides.auth,
    } as ApiClient['auth'],
    connections: {
      create: vi.fn().mockResolvedValue(sampleConnection),
      disable: vi.fn().mockResolvedValue({ ...sampleConnection, status: 'disabled' }),
      getDiagnostics: vi.fn().mockResolvedValue({
        connectionId: 'conn_1',
        connectionName: 'Main PrestaShop Store',
        connectionStatus: 'active',
        lastSucceededAt: null,
        lastFailedAt: null,
        recentErrors: [],
        recentJobs: [],
      }),
      getById: vi.fn().mockResolvedValue(sampleConnection),
      list: vi.fn().mockResolvedValue([sampleConnection]),
      update: vi.fn().mockResolvedValue(sampleConnection),
      ...overrides.connections,
    } as ApiClient['connections'],
    health: {
      getDevStackHealth: vi.fn().mockResolvedValue({
        status: 'ok',
        services: {
          postgres: { status: 'ok' },
          redis: { status: 'ok' },
          prestashop: { status: 'ok' },
        },
        timestamp: '2026-04-06T00:00:00.000Z',
      }),
      ...overrides.health,
    } as ApiClient['health'],
    inventory: {
      list: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      }),
      getById: vi.fn().mockResolvedValue(null),
      ...overrides.inventory,
    } as ApiClient['inventory'],
    orders: {
      list: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      }),
      getById: vi.fn().mockResolvedValue(null),
      ...overrides.orders,
    } as ApiClient['orders'],
    products: {
      list: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      }),
      getById: vi.fn().mockResolvedValue(null),
      ...overrides.products,
    } as ApiClient['products'],
    syncJobs: {
      enqueue: vi.fn().mockResolvedValue({
        jobId: 'job_1',
        status: 'queued',
      }),
      list: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      }),
      getById: vi.fn().mockResolvedValue(null),
      ...overrides.syncJobs,
    } as ApiClient['syncJobs'],
  };
}

const DEFAULT_TEST_USER: SessionUser = {
  id: 'user_1',
  username: 'admin',
  email: 'admin@example.com',
  role: 'admin',
  permissions: [],
};

export function createAuthenticatedSessionAdapter(
  user: SessionUser = DEFAULT_TEST_USER,
): SessionAdapter {
  const token = 'test-jwt-token';
  return {
    async getSession(): Promise<Session> {
      return { status: 'authenticated', accessToken: token, user };
    },
    async getAccessToken(): Promise<string> {
      return token;
    },
    async persistSession(): Promise<void> {},
    async clearSession(): Promise<void> {},
  };
}

export function renderWithProviders(ui: ReactElement, options: RenderWithProvidersOptions = {}): RenderResult {
  const {
    apiClient = createMockApiClient(),
    route = '/',
    sessionAdapter = createNoopSessionAdapter(),
    ...renderOptions
  } = options;
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
        <SessionProvider adapter={sessionAdapter}>
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
