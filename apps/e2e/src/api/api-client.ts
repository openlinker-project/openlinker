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
  ApproveUserInput,
  BulkBatchSummary,
  CategoryMappingInput,
  CategoryParameter,
  CategoryParametersResponse,
  Connection,
  ConnectionFilters,
  CreateConnectionInput,
  UpdateConnectionInput,
  InstallWebhooksResult,
  DispatchResult,
  EnqueueSyncJobInput,
  EnqueueSyncJobResponse,
  GenerateLabelInput,
  InboundWebhookResult,
  ListWebhookDeliveriesQuery,
  InternalHealthResponse,
  InventoryAvailability,
  InventoryAvailabilityResponse,
  InvoiceRecord,
  IssueInvoiceInput,
  IssuedDocumentContent,
  ListInvoicesQuery,
  ListListingsQuery,
  ListOrdersQuery,
  ListProductsQuery,
  ListUsersQuery,
  LoginResponse,
  MarketplaceOffer,
  MeResponse,
  OfferCreationStatus,
  OfferMapping,
  OrderRecord,
  Paginated,
  Product,
  ProductVariant,
  RawResponse,
  RegisterInput,
  RotateWebhookSecretResponse,
  RoutingRule,
  RoutingRuleInput,
  Shipment,
  SyncJob,
  SyncJobListQuery,
  SyncJobListResponse,
  SystemConfig,
  UserListResponse,
  WebhookDeliverySummary,
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

  private credentials: { username: string; password: string } | null = null;

  private reloginPromise: Promise<void> | null = null;

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
    this.credentials = { username, password };
  }

  /**
   * Re-acquire the bearer token after a 401 (single-flight: concurrent 401s
   * share one login call). OL access tokens expire after ~15 minutes, which is
   * shorter than the attended run's purchase pause — without this, every
   * post-pause call would 401 and pollers would mask it as a timeout.
   */
  private relogin(): Promise<void> {
    if (!this.credentials) {
      return Promise.reject(new Error('Cannot re-login: no credentials captured (call login first)'));
    }
    this.reloginPromise ??= this.login(this.credentials.username, this.credentials.password).finally(
      () => {
        this.reloginPromise = null;
      },
    );
    return this.reloginPromise;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { skipAuth?: boolean } = {},
    isRetryAfterRelogin = false,
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
      // Expired access token: re-login once with the captured credentials and
      // retry the request. Never loops — a 401 on the retried request throws.
      if (response.status === 401 && !skipAuth && !isRetryAfterRelogin && this.credentials) {
        await this.relogin();
        return this.request<T>(path, init, true);
      }
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

  /**
   * Fetch a binary endpoint (label PDF, UPO/XML) and report metadata only. The
   * body is drained but not returned — the E2E assertions care that bytes exist
   * and the content-type is right, not the document contents.
   */
  private async requestRaw(path: string, isRetryAfterRelogin = false): Promise<RawResponse> {
    const headers = new Headers();
    if (this.accessToken !== null) {
      headers.set('Authorization', `Bearer ${this.accessToken}`);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${withApiVersion(path)}`, {
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 401 && !isRetryAfterRelogin && this.credentials) {
      await response.arrayBuffer();
      await this.relogin();
      return this.requestRaw(path, true);
    }
    const buffer = await response.arrayBuffer();
    return {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type'),
      byteLength: buffer.byteLength,
    };
  }

  /**
   * The authenticated user's role + derived permissions (GET /auth/me).
   * Throws `ApiError` with status 401 when the client is not authenticated.
   */
  me(): Promise<MeResponse> {
    return this.request<MeResponse>('/auth/me');
  }

  // ── Health ──────────────────────────────────────────────────────────────
  health = {
    liveness: (): Promise<InternalHealthResponse> =>
      this.request<InternalHealthResponse>('/health'),
    devStack: (): Promise<unknown> => this.request<unknown>('/health/dev-stack'),
  };

  // ── System (public) ───────────────────────────────────────────────────────
  system = {
    /** Public runtime flags (demoMode, …). No auth header sent. */
    config: (): Promise<SystemConfig> =>
      this.request<SystemConfig>('/system/config', { skipAuth: true }),
  };

  // ── Webhooks ──────────────────────────────────────────────────────────────
  webhooks = {
    /**
     * Fire a raw inbound webhook at the version-NEUTRAL ingress
     * `/webhooks/:provider/:connectionId` (no `/v1` prefix, no auth header) —
     * exactly the URL an external platform posts to. The raw body string and
     * signature headers are supplied by the caller (see `support/webhooks.ts`),
     * so the request is byte-identical to a real platform delivery. Never throws
     * on non-2xx — returns the status so the spec can assert 202 / 401 itself.
     */
    sendInbound: async (
      provider: string,
      connectionId: string,
      rawBody: string,
      headers: Record<string, string>,
    ): Promise<InboundWebhookResult> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/webhooks/${provider}/${connectionId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: rawBody,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      const raw = await response.text();
      return {
        status: response.status,
        ok: response.ok,
        body: raw.length > 0 ? this.tryParseJson(raw) : undefined,
      };
    },

    /** List recorded webhook deliveries (admin). Summary rows, no payload. */
    listDeliveries: (query?: ListWebhookDeliveriesQuery): Promise<Paginated<WebhookDeliverySummary>> =>
      this.request<Paginated<WebhookDeliverySummary>>(
        `/webhook-deliveries${buildQuery({
          provider: query?.provider,
          connectionId: query?.connectionId,
          eventType: query?.eventType,
          status: query?.status,
          since: query?.since,
          until: query?.until,
          limit: query?.limit,
          offset: query?.offset,
        })}`,
      ),
  };

  // ── Auth (registration) ───────────────────────────────────────────────────
  auth = {
    /**
     * Self-service registration (public). Resolves on 201; throws `ApiError`
     * on 403 (disabled), 409 (duplicate), or 429 (demo per-IP rate limit).
     */
    register: (input: RegisterInput): Promise<void> =>
      this.request<void>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(input),
        skipAuth: true,
      }),
  };

  // ── Users (admin only) ────────────────────────────────────────────────────
  users = {
    list: (query?: ListUsersQuery): Promise<UserListResponse> =>
      this.request<UserListResponse>(
        `/users${buildQuery({ status: query?.status, page: query?.page, pageSize: query?.pageSize })}`,
      ),
    /** Approve a pending registration with a role. Returns 204 (no body). */
    approve: (userId: string, roleBody: ApproveUserInput): Promise<void> =>
      this.request<void>(`/users/${userId}/approve`, {
        method: 'POST',
        body: JSON.stringify(roleBody),
      }),
  };

  // ── AI provider settings (admin only) ─────────────────────────────────────
  aiProviderSettings = {
    /** Admin-only read; the E2E specs assert only on the resolved/failed status. */
    get: (): Promise<unknown> => this.request<unknown>('/ai-provider-settings'),
  };

  // ── Connections ─────────────────────────────────────────────────────────
  connections = {
    list: (filters?: ConnectionFilters): Promise<Connection[]> =>
      this.request<Connection[]>(
        `/connections${buildQuery({ platformType: filters?.platformType, status: filters?.status })}`,
      ),
    getById: (connectionId: string): Promise<Connection> =>
      this.request<Connection>(`/connections/${connectionId}`),
    /** Create a connection (admin). Throws `ApiError` (400) on an invalid config/capability set. */
    create: (input: CreateConnectionInput): Promise<Connection> =>
      this.request<Connection>('/connections', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    /** Patch a connection (admin) — config, status, adapterKey, enabledCapabilities. */
    update: (connectionId: string, input: UpdateConnectionInput): Promise<Connection> =>
      this.request<Connection>(`/connections/${connectionId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    /**
     * Rotate the connection's webhook secret (admin). Returns the new plaintext
     * secret ONCE — the E2E webhook spec uses it to compute the OL-HMAC
     * signature an external platform would send.
     */
    rotateWebhookSecret: (connectionId: string): Promise<RotateWebhookSecretResponse> =>
      this.request<RotateWebhookSecretResponse>(
        `/connections/${connectionId}/webhooks/secret/rotate`,
        { method: 'POST' },
      ),
    /** Auto-provision webhook config on the external platform for this connection (#168, #583). */
    installWebhooks: (connectionId: string): Promise<InstallWebhooksResult> =>
      this.request<InstallWebhooksResult>(`/connections/${connectionId}/webhooks/install`, {
        method: 'POST',
      }),
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
    /** Adapter-fetched live offer (category id + price + qty + status). */
    getOffer: (id: string): Promise<MarketplaceOffer> =>
      this.request<MarketplaceOffer>(`/listings/${id}/offer`),
    /** Category parameter directory (offer- + product-section) for a connection. */
    categoryParameters: (connectionId: string, categoryId: string): Promise<CategoryParameter[]> =>
      this.request<CategoryParametersResponse>(
        `/listings/connections/${connectionId}/categories/${categoryId}/parameters`,
      ).then((response) => response.parameters),
    /** Bulk offer-creation batch progress: per-variant creation records. */
    getBulkBatch: (batchId: string): Promise<BulkBatchSummary> =>
      this.request<BulkBatchSummary>(`/listings/bulk-create/${batchId}`),
    /**
     * Offer-creation record detail, incl. the persisted request snapshot
     * (`request.overrides.parameters` = submitted category-parameter values).
     */
    getOfferCreationRecord: (
      connectionId: string,
      offerCreationRecordId: string,
    ): Promise<OfferCreationStatus> =>
      this.request<OfferCreationStatus>(
        `/listings/connections/${connectionId}/offers/creation/${offerCreationRecordId}`,
      ),
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
    /**
     * Issue a fiscal document for an order (POST /invoices). The server
     * assembles lines/buyer from the order — the correct seam for the E2E flow
     * (the `invoicing.issue` job requires a fully pre-assembled payload).
     */
    issue: (input: IssueInvoiceInput): Promise<InvoiceRecord> =>
      this.request<InvoiceRecord>('/invoices', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    /** Amount/tax surface of an issued document (per-line net/VAT/gross, totals, buyer tax id). */
    getContent: (invoiceId: string): Promise<IssuedDocumentContent> =>
      this.request<IssuedDocumentContent>(`/invoices/${invoiceId}/content`),
    /** UPO / clearance confirmation document — bytes-only check. */
    getUpo: (invoiceId: string): Promise<RawResponse> =>
      this.requestRaw(`/invoices/${invoiceId}/upo`),
    /** Source FA(3) XML document — bytes-only check. */
    getSourceDocument: (invoiceId: string): Promise<RawResponse> =>
      this.requestRaw(`/invoices/${invoiceId}/document${buildQuery({ kind: 'source' })}`),
  };

  // ── Shipments ───────────────────────────────────────────────────────────
  shipments = {
    active: (orderId: string): Promise<Shipment | null> =>
      this.request<Shipment | null>(`/shipments/active${buildQuery({ orderId })}`),
    getById: (id: string): Promise<Shipment> => this.request<Shipment>(`/shipments/${id}`),
    /** Retrieve the generated label bytes (PDF/ZPL/PNG). */
    getLabel: (id: string): Promise<RawResponse> => this.requestRaw(`/shipments/${id}/label`),
    /** Generate a carrier label for an order (mutating — attended run only). */
    generateLabel: (input: GenerateLabelInput): Promise<DispatchResult> =>
      this.request<DispatchResult>('/shipments/generate-label', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    /** Mark a shipment dispatched (mutating — attended run only). */
    notifyDispatched: (id: string): Promise<Shipment> =>
      this.request<Shipment>(`/shipments/${id}/notify-dispatched`, { method: 'POST' }),
  };

  // ── Sync jobs ───────────────────────────────────────────────────────────
  syncJobs = {
    enqueue: (input: EnqueueSyncJobInput): Promise<EnqueueSyncJobResponse> =>
      this.request<EnqueueSyncJobResponse>('/sync/jobs', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    getById: (id: string): Promise<SyncJob> => this.request<SyncJob>(`/sync/jobs/${id}`),
    list: (query: SyncJobListQuery = {}): Promise<SyncJobListResponse> => {
      const params = new URLSearchParams();
      if (query.connectionId) params.set('connectionId', query.connectionId);
      if (query.jobType) params.set('jobType', query.jobType);
      if (query.status) params.set('status', query.status);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      const qs = params.toString();
      return this.request<SyncJobListResponse>(`/sync/jobs${qs ? `?${qs}` : ''}`);
    },
  };

  // ── Mappings ────────────────────────────────────────────────────────────
  mappings = {
    /**
     * Upsert a source→destination category mapping (the operator's PS→Allegro
     * category-mapping step). `connectionId` is the DESTINATION (Allegro)
     * connection; `sourceCategoryId` is the source (PrestaShop) category id.
     */
    upsertCategoryMapping: (
      connectionId: string,
      sourceCategoryId: string,
      body: CategoryMappingInput,
    ): Promise<unknown> =>
      this.request<unknown>(
        `/connections/${connectionId}/mappings/categories/${sourceCategoryId}`,
        { method: 'PUT', body: JSON.stringify(body) },
      ),
  };

  // ── Mapping options (#472 / #1551) ─────────────────────────────────────
  mappingOptions = {
    /**
     * Destination-platform order-status vocabulary for the connection-mappings
     * UI. `MappingOptionsController` resolves the destination side by pairing
     * platformType — today only Allegro<->PrestaShop; other platforms (incl.
     * `woocommerce`) 400. Used by the WooCommerce-parity suite to assert that
     * documented gap explicitly rather than silently skip it (#1571 scenario 7).
     */
    getDestinationOrderStatuses: (connectionId: string): Promise<unknown[]> =>
      this.request<unknown[]>(`/connections/${connectionId}/mappings/options/destination/order-statuses`),
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
