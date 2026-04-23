import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, type RenderOptions, type RenderResult } from '@testing-library/react';
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
  credentialsBacked: true,
  adapterKey: 'prestashop.webservice.v1',
  enabledCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderProcessorManager', 'OrderSource'],
  supportedCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderProcessorManager', 'OrderSource'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

type DeepPartialApiClient = {
  request?: ApiClient['request'];
  adapters?: Partial<ApiClient['adapters']>;
  allegro?: Partial<ApiClient['allegro']>;
  auth?: Partial<ApiClient['auth']>;
  connections?: Partial<ApiClient['connections']>;
  content?: Partial<ApiClient['content']>;
  cursors?: Partial<ApiClient['cursors']>;
  customers?: Partial<ApiClient['customers']>;
  health?: Partial<ApiClient['health']>;
  inventory?: Partial<ApiClient['inventory']>;
  listings?: Partial<ApiClient['listings']>;
  orders?: Partial<ApiClient['orders']>;
  products?: Partial<ApiClient['products']>;
  promptTemplates?: Partial<ApiClient['promptTemplates']>;
  mappings?: Partial<ApiClient['mappings']>;
  syncJobs?: Partial<ApiClient['syncJobs']>;
  webhookDeliveries?: Partial<ApiClient['webhookDeliveries']>;
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
      forgotPassword: vi.fn().mockResolvedValue({ ok: true }),
      resetPassword: vi.fn().mockResolvedValue({ ok: true }),
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
      test: vi.fn().mockResolvedValue({ success: true, status: 200, message: 'OK', latencyMs: 42 }),
      update: vi.fn().mockResolvedValue(sampleConnection),
      updateCredentials: vi.fn().mockResolvedValue(undefined),
      ...overrides.connections,
    } as ApiClient['connections'],
    content: {
      get: vi.fn().mockResolvedValue({
        productId: 'prod_1',
        master: {
          baseValue: null,
          draftValue: null,
          hasConflict: false,
          updatedAt: null,
          updatedBy: null,
        },
        channels: [],
      }),
      saveDraft: vi.fn().mockResolvedValue({
        id: 'field_1',
        productId: 'prod_1',
        connectionId: null,
        fieldKey: 'description',
        baseValue: null,
        draftValue: null,
        baseVersion: null,
        hasConflict: false,
        updatedAt: '2026-04-23T00:00:00.000Z',
        updatedBy: 'user_1',
      }),
      discardDraft: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockResolvedValue({
        id: 'field_1',
        productId: 'prod_1',
        connectionId: null,
        fieldKey: 'description',
        baseValue: null,
        draftValue: null,
        baseVersion: null,
        hasConflict: false,
        updatedAt: '2026-04-23T00:00:00.000Z',
        updatedBy: 'user_1',
      }),
      suggest: vi.fn().mockResolvedValue({
        suggestion: '',
        requestId: 'req_1',
        templateKey: 'offer.description.suggest',
        templateVersion: 1,
        templateChannel: null,
        modelUsed: 'fake',
        latencyMs: 0,
        usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      }),
      ...overrides.content,
    } as ApiClient['content'],
    cursors: {
      list: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      }),
      ...overrides.cursors,
    } as ApiClient['cursors'],
    customers: {
      list: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      }),
      getById: vi.fn().mockResolvedValue(null),
      ...overrides.customers,
    } as ApiClient['customers'],
    health: {
      getDevStackHealth: vi.fn().mockResolvedValue({
        status: 'ok',
        services: {
          postgres: { status: 'ok' },
          redis: { status: 'ok' },
          prestashop: { status: 'ok' },
          worker: { status: 'ok' },
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
    listings: {
      list: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      }),
      getById: vi.fn().mockResolvedValue(null),
      updateOfferFields: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
      createOffer: vi.fn().mockResolvedValue({ jobId: 'job-1', offerCreationRecordId: 'rec-1' }),
      // Tests that render the tracker must override with a full-shape response — the `null`
      // default mirrors the `getById` pattern and forces explicit test setup.
      getOfferCreationStatus: vi.fn().mockResolvedValue(null),
      getSellerPolicies: vi.fn().mockResolvedValue({
        deliveryPolicies: [],
        returnPolicies: [],
        warranties: [],
        impliedWarranties: [],
      }),
      ...overrides.listings,
    } as ApiClient['listings'],
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
    promptTemplates: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      getVersions: vi.fn().mockResolvedValue([]),
      getLatest: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(null),
      publish: vi.fn().mockResolvedValue(null),
      revert: vi.fn().mockResolvedValue(null),
      render: vi.fn().mockResolvedValue({ templateId: '', version: 1, systemPrompt: '', userPrompt: '' }),
      remove: vi.fn().mockResolvedValue(undefined),
      ...overrides.promptTemplates,
    } as ApiClient['promptTemplates'],
    mappings: {
      getStatusMappings: vi.fn().mockResolvedValue([]),
      upsertStatusMappings: vi.fn().mockResolvedValue([]),
      getCarrierMappings: vi.fn().mockResolvedValue([]),
      upsertCarrierMappings: vi.fn().mockResolvedValue([]),
      getPaymentMappings: vi.fn().mockResolvedValue([]),
      upsertPaymentMappings: vi.fn().mockResolvedValue([]),
      getAllegroOrderStatuses: vi.fn().mockResolvedValue([]),
      getAllegroDeliveryMethods: vi.fn().mockResolvedValue([]),
      getAllegroPaymentProviders: vi.fn().mockResolvedValue([]),
      getPrestashopOrderStatuses: vi.fn().mockResolvedValue([]),
      getPrestashopCarriers: vi.fn().mockResolvedValue([]),
      getPrestashopPaymentModules: vi.fn().mockResolvedValue([]),
      ...overrides.mappings,
    } as ApiClient['mappings'],
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
      retry: vi.fn().mockResolvedValue(null),
      listGrouped: vi.fn().mockResolvedValue({
        groups: [],
        totalGroups: 0,
        totalJobs: 0,
      }),
      retryGrouped: vi.fn().mockResolvedValue({
        requeuedJobIds: [],
        count: 0,
        skipped: 0,
      }),
      ...overrides.syncJobs,
    } as ApiClient['syncJobs'],
    webhookDeliveries: {
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getById: vi.fn().mockResolvedValue(null),
      ...overrides.webhookDeliveries,
    } as ApiClient['webhookDeliveries'],
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

/**
 * Toast text helpers.
 *
 * `@radix-ui/react-toast` renders every toast twice — once visibly inside the
 * Viewport (`.toast__title` / `.toast__description` in our wrapper) and once
 * inside a hidden `ToastAnnounce` portal for screen readers. The announce
 * portal hides itself ~1000ms after mount, creating a race window where a
 * plain `screen.getByText(...)` intermittently matches both copies and throws.
 * Scope toast-text assertions to the visible `.toast__*` elements to skip the
 * announce portal entirely.
 */
export function findToastTitle(text: string | RegExp): Promise<HTMLElement> {
  return screen.findByText(text, { selector: '.toast__title' });
}

export function getToastTitle(text: string | RegExp): HTMLElement {
  return screen.getByText(text, { selector: '.toast__title' });
}

export function findToastDescription(text: string | RegExp): Promise<HTMLElement> {
  return screen.findByText(text, { selector: '.toast__description' });
}

export function getToastDescription(text: string | RegExp): HTMLElement {
  return screen.getByText(text, { selector: '.toast__description' });
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
        gcTime: 0,
      },
      mutations: {
        retry: false,
        gcTime: 0,
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
