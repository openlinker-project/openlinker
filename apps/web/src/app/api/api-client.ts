import { createAdaptersApi, type AdaptersApi } from '../../features/adapters/api/adapters.api';
import { createAllegroApi, type AllegroApi } from '../../features/allegro/api/allegro.api';
import { createAuthApi, type AuthApi } from '../../features/auth/api/auth.api';
import { createConnectionsApi, type ConnectionsApi } from '../../features/connections/api/connections.api';
import { createContentApi, type ContentApi } from '../../features/content/api/content.api';
import { createCursorsApi, type CursorsApi } from '../../features/cursors/api/cursors.api';
import { createCustomersApi, type CustomersApi } from '../../features/customers/api/customers.api';
import { createHealthApi, type HealthApi } from '../../features/health/api/health.api';
import { createInventoryApi, type InventoryApi } from '../../features/inventory/api/inventory.api';
import { createListingsApi, type ListingsApi } from '../../features/listings/api/listings.api';
import { createOrdersApi, type OrdersApi } from '../../features/orders/api/orders.api';
import { createProductsApi, type ProductsApi } from '../../features/products/api/products.api';
import {
  createPromptTemplatesApi,
  type PromptTemplatesApi,
} from '../../features/prompt-templates/api/prompt-templates.api';
import { createSyncJobsApi, type SyncJobsApi } from '../../features/sync-jobs/api/sync.api';
import { createMappingsApi, type MappingsApi } from '../../features/mappings/api/mappings.api';
import {
  createWebhookDeliveriesApi,
  type WebhookDeliveriesApi,
} from '../../features/webhook-deliveries/api/webhook-deliveries.api';
import { ApiError } from '../../shared/api/api-error';
import type { SessionAdapter } from '../../shared/auth/session-adapter';

const DEFAULT_TIMEOUT_MS = 30_000;

interface ApiClientConfig {
  baseUrl: string;
  fetchFn?: typeof fetch;
  requestTimeoutMs?: number;
  sessionAdapter: SessionAdapter;
}

export interface ApiClient {
  adapters: AdaptersApi;
  allegro: AllegroApi;
  auth: AuthApi;
  connections: ConnectionsApi;
  content: ContentApi;
  cursors: CursorsApi;
  customers: CustomersApi;
  health: HealthApi;
  inventory: InventoryApi;
  listings: ListingsApi;
  orders: OrdersApi;
  products: ProductsApi;
  promptTemplates: PromptTemplatesApi;
  mappings: MappingsApi;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  syncJobs: SyncJobsApi;
  webhookDeliveries: WebhookDeliveriesApi;
}

function buildUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(/\/$/, '')}/`).toString();
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return response.json() as Promise<unknown>;
  }

  return response.text();
}

export function createApiClient({
  baseUrl,
  fetchFn = fetch,
  requestTimeoutMs = DEFAULT_TIMEOUT_MS,
  sessionAdapter,
}: ApiClientConfig): ApiClient {
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const accessToken = await sessionAdapter.getAccessToken();
    const headers = new Headers(init.headers);

    headers.set('Accept', 'application/json');

    if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    if (accessToken !== null) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => { controller.abort(); }, requestTimeoutMs);
    // Combine the timeout signal with any caller-supplied signal so both can abort the request
    const signal = init.signal
      ? AbortSignal.any([controller.signal, init.signal])
      : controller.signal;

    try {
      const response = await fetchFn(buildUrl(baseUrl, path), {
        ...init,
        headers,
        signal,
      });

      clearTimeout(timeoutId);

      const payload = await readResponseBody(response);

      if (!response.ok) {
        throw ApiError.fromResponse(response, payload);
      }

      return payload as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof ApiError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw ApiError.fromTimeout(path);
      }

      throw ApiError.fromNetworkFailure(error);
    }
  };

  return {
    adapters: createAdaptersApi(request),
    allegro: createAllegroApi(request),
    auth: createAuthApi(request),
    connections: createConnectionsApi(request),
    content: createContentApi(request),
    cursors: createCursorsApi(request),
    customers: createCustomersApi(request),
    health: createHealthApi(request),
    inventory: createInventoryApi(request),
    listings: createListingsApi(request),
    mappings: createMappingsApi(request),
    orders: createOrdersApi(request),
    products: createProductsApi(request),
    promptTemplates: createPromptTemplatesApi(request),
    request,
    syncJobs: createSyncJobsApi(request),
    webhookDeliveries: createWebhookDeliveriesApi(request),
  };
}
