/**
 * Node API client
 *
 * A typed, framework-free HTTP client for the OpenLinker REST API, used by E2E
 * setup / verification / job-triggering code (the "node" auth path). Unlike the
 * browser (which uses a memory access token + HttpOnly refresh cookie + CSRF),
 * this client authenticates once via `POST /auth/login` and sends the returned
 * bearer token on every subsequent request — no cookie/CSRF dance.
 *
 * All paths are version-neutral at the call site; the client prepends the `/v1`
 * segment (mirroring the FE `withApiVersion` helper) so callers pass `/orders`,
 * not `/v1/orders`.
 *
 * @module api
 */
import { ApiError } from './api-error';
import type {
  Connection,
  ConnectionFilters,
  EnqueueSyncJobInput,
  EnqueueSyncJobResponse,
  InternalHealthResponse,
  InventoryAvailability,
  InventoryAvailabilityResponse,
  InvoiceRecord,
  ListInvoicesQuery,
  ListListingsQuery,
  ListOrdersQuery,
  ListProductsQuery,
  LoginResponse,
  OfferMapping,
  OrderRecord,
  Paginated,
  Product,
  ProductVariant,
  RoutingRule,
  RoutingRuleInput,
  SyncJob,
} from './api.types';

const API_VERSION_PREFIX = '/v1';

export interface ApiClientOptions {
  /** REST API base ORIGIN, e.g. `http://localhost:3000` (no `/v1`). */
  baseUrl: string;
  /** Per-request timeout in ms. */
  requestTimeoutMs?: number;
}

function withApiVersion(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (normalized === API_VERSION_PREFIX || normalized.startsWith(`${API_VERSION_PREFIX}/`)) {
    return normalized;
  }
  return `${API_VERSION_PREFIX}${normalized}`;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class ApiClient {
  private accessToken: string | null = null;

  private readonly baseUrl: string;

  private readonly requestTimeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Whether a bearer token has been acquired. */
  get isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  /** Authenticate and cache the bearer token for subsequent requests. */
  async login(username: string, password: string): Promise<void> {
    const result = await this.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      skipAuth: true,
    });
    this.accessToken = result.access_token;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { skipAuth?: boolean } = {},
  ): Promise<T> {
    const { skipAuth, ...requestInit } = init;
    const method = requestInit.method ?? 'GET';
    const headers = new Headers(requestInit.headers);
    headers.set('Accept', 'application/json');
    if (requestInit.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (!skipAuth && this.accessToken !== null) {
      headers.set('Authorization', `Bearer ${this.accessToken}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${withApiVersion(path)}`, {
        ...requestInit,
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const raw = await response.text();
    const body: unknown = raw.length > 0 ? this.tryParseJson(raw) : undefined;

    if (!response.ok) {
      throw new ApiError(response.status, method, path, body);
    }

    return body as T;
  }

  private tryParseJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  // ── Health ──────────────────────────────────────────────────────────────
  health = {
    liveness: (): Promise<InternalHealthResponse> =>
      this.request<InternalHealthResponse>('/health'),
    devStack: (): Promise<unknown> => this.request<unknown>('/health/dev-stack'),
  };

  // ── Connections ─────────────────────────────────────────────────────────
  connections = {
    list: (filters?: ConnectionFilters): Promise<Connection[]> =>
      this.request<Connection[]>(
        `/connections${buildQuery({ platformType: filters?.platformType, status: filters?.status })}`,
      ),
    getById: (connectionId: string): Promise<Connection> =>
      this.request<Connection>(`/connections/${connectionId}`),
  };

  // ── Products ────────────────────────────────────────────────────────────
  products = {
    list: (query?: ListProductsQuery): Promise<Paginated<Product>> =>
      this.request<Paginated<Product>>(
        `/products${buildQuery({ search: query?.search, limit: query?.limit, offset: query?.offset })}`,
      ),
    getById: (productId: string): Promise<Product> =>
      this.request<Product>(`/products/${productId}`),
    listVariants: (productId: string): Promise<Paginated<ProductVariant>> =>
      this.request<Paginated<ProductVariant>>(`/products/${productId}/variants`),
  };

  // ── Inventory ───────────────────────────────────────────────────────────
  inventory = {
    availability: (variantIds: string[]): Promise<InventoryAvailability[]> =>
      this.request<InventoryAvailabilityResponse>(
        `/inventory/availability${buildQuery({ productVariantIds: variantIds.join(',') })}`,
      ).then((response) => response.items),
  };

  // ── Listings (offers) ───────────────────────────────────────────────────
  listings = {
    list: (query?: ListListingsQuery): Promise<Paginated<OfferMapping>> =>
      this.request<Paginated<OfferMapping>>(
        `/listings${buildQuery({
          connectionId: query?.connectionId,
          platformType: query?.platformType,
          internalId: query?.internalId,
          search: query?.search,
          limit: query?.limit,
          offset: query?.offset,
        })}`,
      ),
    getById: (id: string): Promise<OfferMapping> =>
      this.request<OfferMapping>(`/listings/${id}`),
  };

  // ── Orders ──────────────────────────────────────────────────────────────
  orders = {
    list: (query?: ListOrdersQuery): Promise<Paginated<OrderRecord>> =>
      this.request<Paginated<OrderRecord>>(
        `/orders${buildQuery({
          sourceConnectionId: query?.sourceConnectionId,
          syncStatus: query?.syncStatus,
          limit: query?.limit,
          offset: query?.offset,
        })}`,
      ),
    getById: (internalOrderId: string): Promise<OrderRecord> =>
      this.request<OrderRecord>(`/orders/${internalOrderId}`),
  };

  // ── Invoices ────────────────────────────────────────────────────────────
  invoices = {
    list: (query?: ListInvoicesQuery): Promise<Paginated<InvoiceRecord>> =>
      this.request<Paginated<InvoiceRecord>>(
        `/invoices${buildQuery({
          status: query?.status,
          connectionId: query?.connectionId,
          regulatoryStatus: query?.regulatoryStatus,
          limit: query?.limit,
          offset: query?.offset,
        })}`,
      ),
    getById: (invoiceId: string): Promise<InvoiceRecord> =>
      this.request<InvoiceRecord>(`/invoices/${invoiceId}`),
    getForOrder: (orderId: string, connectionId: string): Promise<InvoiceRecord> =>
      this.request<InvoiceRecord>(
        `/orders/${orderId}/invoice${buildQuery({ connectionId })}`,
      ),
  };

  // ── Sync jobs ───────────────────────────────────────────────────────────
  syncJobs = {
    enqueue: (input: EnqueueSyncJobInput): Promise<EnqueueSyncJobResponse> =>
      this.request<EnqueueSyncJobResponse>('/sync/jobs', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    getById: (id: string): Promise<SyncJob> => this.request<SyncJob>(`/sync/jobs/${id}`),
  };

  // ── Routing rules ───────────────────────────────────────────────────────
  routingRules = {
    list: (connectionId: string): Promise<RoutingRule[]> =>
      this.request<RoutingRule[]>(`/connections/${connectionId}/routing-rules`),
    replace: (connectionId: string, items: RoutingRuleInput[]): Promise<RoutingRule[]> =>
      this.request<RoutingRule[]>(`/connections/${connectionId}/routing-rules`, {
        method: 'PUT',
        body: JSON.stringify({ items }),
      }),
  };
}
