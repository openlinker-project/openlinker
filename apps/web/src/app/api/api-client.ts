/**
 * API client — composition of feature API factories
 *
 * Owns the typed `ApiClient` interface and the `createApiClient` factory.
 * Split into two surfaces (#605):
 *
 *   - `CoreApiClient` — namespaces every host needs (auth, health, generic
 *     resource CRUD). Closed and shipped with the host.
 *   - `PluginApiNamespaces` — empty by default; plugins extend it via TS
 *     declaration merging (see `apps/web/src/plugins/<name>/index.ts`).
 *
 *   `ApiClient = CoreApiClient & PluginApiNamespaces`.
 *
 * Composition order in `createApiClient`: build core namespaces → iterate
 * `plugins` and merge each plugin's `apiNamespaces(request)` result. Caller
 * overrides (test-utils only) merge last; see `apps/web/src/test/test-utils.tsx`.
 *
 * @module app/api
 * @see apps/web/src/plugins/plugin.types.ts — the WebPlugin contract
 */
import { createAdaptersApi, type AdaptersApi } from '../../features/adapters/api/adapters.api';
import {
  createAiProviderSettingsApi,
  type AiProviderSettingsApi,
} from '../../features/ai-provider-settings/api/ai-provider-settings.api';
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
import { plugins } from '../../plugins';
import { ApiError } from '../../shared/api/api-error';
import type { SessionAdapter } from '../../shared/auth/session-adapter';

const DEFAULT_TIMEOUT_MS = 30_000;

interface ApiClientConfig {
  baseUrl: string;
  fetchFn?: typeof fetch;
  requestTimeoutMs?: number;
  sessionAdapter: SessionAdapter;
}

/**
 * The bound `request` function plugins receive from `createApiClient`.
 * Already wraps auth-header injection, timeout, and error normalisation.
 * Exposed as a named export so plugin types have a stable import target.
 */
export type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

/**
 * Plugin-augmentable surface. Empty by default; each plugin extends it
 * via `declare module '../../app/api/api-client'` (see the allegro plugin
 * for the canonical pattern). The empty form is the documented TS shape
 * for declaration-merging seams. `@typescript-eslint/no-empty-interface`
 * is not enabled in the repo's eslint config (verified 2026-05-11), so no
 * inline disable is needed; if the rule is added later, this is the line
 * to exempt.
 */
export interface PluginApiNamespaces {}

export interface CoreApiClient {
  adapters: AdaptersApi;
  aiProviderSettings: AiProviderSettingsApi;
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
  request: ApiRequest;
  syncJobs: SyncJobsApi;
  webhookDeliveries: WebhookDeliveriesApi;
}

export type ApiClient = CoreApiClient & PluginApiNamespaces;

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
  const request: ApiRequest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
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

  const core: CoreApiClient = {
    adapters: createAdaptersApi(request),
    aiProviderSettings: createAiProviderSettingsApi(request),
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

  const pluginNamespaces: Partial<PluginApiNamespaces> = {};
  for (const plugin of plugins) {
    if (plugin.apiNamespaces) {
      Object.assign(pluginNamespaces, plugin.apiNamespaces(request));
    }
  }

  // Single boundary cast. The structural shape is guaranteed by the union of
  // CoreApiClient (built above) and PluginApiNamespaces (augmented at compile
  // time). Caveat the cast hides: declaration merging makes TS believe every
  // augmented key is present, but the runtime presence depends on each plugin
  // returning the right shape from `apiNamespaces`. A plugin that declares
  // `allegro: AllegroApi` but forgets to return `{ allegro: … }` produces a
  // type-checking `client.allegro` that is actually `undefined` at runtime —
  // surfaces only at the call site.
  return { ...core, ...pluginNamespaces } as ApiClient;
}
