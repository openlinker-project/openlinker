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
  AnalyticsCoverageView,
  AnalyticsRangeQuery,
  AnalyticsRemediationRun,
  AnalyticsSettingsView,
  CurrencyMismatchOrder,
  CurrencySettingsView,
  ProductMatchingOrder,
  TaxCoverageOrder,
  TaxRerunBackfillResult,
  UpdateAnalyticsSettingsInput,
  ProductContentState,
  ApproveUserInput,
  BulkBatchSummary,
  DescriptionFormatView,
  BulkIssueInvoicesInput,
  BulkIssueInvoicesResult,
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
  InvoicingBankAccount,
  IssueCorrectionInput,
  IssueInvoiceInput,
  IssuedDocumentContent,
  ListInvoicesQuery,
  ListListingsQuery,
  ListOrdersQuery,
  ListProductsQuery,
  ListUsersQuery,
  LoginResponse,
  MarkInvoicePaidInput,
  MarketplaceOffer,
  MeResponse,
  OfferCreationStatus,
  OfferMapping,
  OrderHealthSummary,
  OrderRecord,
  Paginated,
  Product,
  ProductVariant,
  RawResponse,
  RawTextResponse,
  RegisterInput,
  RotateWebhookSecretResponse,
  RoutingRule,
  RoutingRuleInput,
  SendInvoiceEmailInput,
  SendInvoiceEmailResult,
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

function buildQuery(
  params: Record<string, string | number | boolean | undefined>,
): string {
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

  /**
   * `fetch()` with the client's per-request timeout applied via an
   * `AbortController` (aborts + always clears the timer). The single place the
   * timeout plumbing lives — every request path funnels through here so the
   * `setTimeout`/`finally clearTimeout` dance can't drift between methods.
   */
  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Headers with the bearer `Authorization` set when a token has been acquired. */
  private authHeaders(extra?: HeadersInit): Headers {
    const headers = new Headers(extra);
    if (this.accessToken !== null) {
      headers.set('Authorization', `Bearer ${this.accessToken}`);
    }
    return headers;
  }

  /**
   * Raw fetch that re-logins once on a 401 (shared by the binary/text paths
   * that don't parse JSON or throw `ApiError`). `drain` frees the socket by
   * reading the 401 body in the kind the caller will read (text vs arrayBuffer)
   * before the retry, which re-issues the request with a freshly-minted token.
   * Retries at most once — a 401 on the retried request is returned as-is.
   */
  private async fetchRawWithRelogin(
    url: string,
    init: RequestInit,
    drain: (response: Response) => Promise<unknown>,
  ): Promise<Response> {
    const response = await this.fetchWithTimeout(url, { ...init, headers: this.authHeaders(init.headers) });
    if (response.status === 401 && this.credentials) {
      await drain(response);
      await this.relogin();
      return this.fetchWithTimeout(url, { ...init, headers: this.authHeaders(init.headers) });
    }
    return response;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { skipAuth?: boolean } = {},
    isRetryAfterRelogin = false,
  ): Promise<T> {
    const { skipAuth, ...requestInit } = init;
    const method = requestInit.method ?? 'GET';
    const headers = skipAuth ? new Headers(requestInit.headers) : this.authHeaders(requestInit.headers);
    headers.set('Accept', 'application/json');
    if (requestInit.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await this.fetchWithTimeout(`${this.baseUrl}${withApiVersion(path)}`, {
      ...requestInit,
      headers,
    });

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
   * Fetch a binary endpoint and retain the decoded text body alongside the
   * usual metadata — used where an assertion needs to inspect the actual
   * bytes (e.g. grepping the FA(3) source XML for specific elements), unlike
   * `requestRaw` which drains and discards the body.
   */
  private async requestRawText(path: string): Promise<RawTextResponse> {
    const response = await this.fetchRawWithRelogin(
      `${this.baseUrl}${withApiVersion(path)}`,
      {},
      (r) => r.text(),
    );
    const text = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type'),
      byteLength: Buffer.byteLength(text, 'utf-8'),
      text,
    };
  }

  /**
   * Fetch a binary endpoint (label PDF, UPO/XML) and report metadata only. The
   * body is drained but not returned — the E2E assertions care that bytes exist
   * and the content-type is right, not the document contents.
   */
  private async requestRaw(path: string): Promise<RawResponse> {
    const response = await this.fetchRawWithRelogin(
      `${this.baseUrl}${withApiVersion(path)}`,
      {},
      (r) => r.arrayBuffer(),
    );
    const buffer = await response.arrayBuffer();
    return {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type'),
      byteLength: buffer.byteLength,
    };
  }

  /**
   * POST variant of `requestRaw` for binary command endpoints (the handover
   * protocol) — same metadata-only contract (bytes exist + content-type), just
   * with a JSON request body. Kept separate from the JSON `request<T>` path
   * because the response here is never JSON.
   */
  private async requestRawPost(path: string, body: unknown): Promise<RawResponse> {
    const response = await this.fetchRawWithRelogin(
      `${this.baseUrl}${withApiVersion(path)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      (r) => r.arrayBuffer(),
    );
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
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/webhooks/${provider}/${connectionId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: rawBody,
        },
      );
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
    /**
     * Permanently delete a user (`DELETE /users/:id`, admin only, 204).
     *
     * Wired for the account sweep in `support/access-control.ts`: without it
     * every run left its `e2e-viewer-*` / `e2e-register-*` accounts behind on a
     * shared - possibly internet-reachable - demo stack, at least one of them an
     * ACTIVE `viewer`. Works on any non-admin account directly (no deactivate
     * step); 403 guards only self-deletion and the last admin.
     */
    delete: (userId: string): Promise<void> =>
      this.request<void>(`/users/${userId}`, { method: 'DELETE' }),
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

  // ── Content (per-product, per-channel descriptions) ─────────────────────
  content = {
    /**
     * Master + per-channel description state for a product (#2201).
     *
     * `channels` is what makes the Content tab's channel tabs exist - a channel
     * appears only when an active connection with `OfferFieldUpdater` has at
     * least one linked offer for the product. A spec that needs a channel editor
     * uses this to FIND such a product rather than assuming one exists, so it
     * skips cleanly on a stack where none does.
     */
    forProduct: (productId: string): Promise<ProductContentState> =>
      // `products/:id/content`, not `content/products/:id` - the controller is
      // mounted under the product resource (`content.controller.ts`).
      this.request<ProductContentState>(`/products/${productId}/content`),
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
    /**
     * A bulk offer-creation batch and its per-record failure reasons.
     *
     * A batch whose every job is rejected still exists and reports its reason
     * here; callers waiting only on the downstream effect (offer mappings)
     * would otherwise see nothing but a timeout.
     */
    bulkBatch: (batchId: string): Promise<BulkBatchSummary> =>
      this.request<BulkBatchSummary>(`/listings/bulk-create/${batchId}`),
    /**
     * The destination's category projection, one level from the root (#1979).
     *
     * Used as a precondition, not as data: the wizard's row editor cannot resolve
     * a category when this is empty, so a spec that must open that editor skips
     * with a reason naming the empty projection instead of failing deep inside a
     * category browser. `null` when the API predates the route.
     */
    taxonomyCategories: async (connectionId: string): Promise<unknown[] | null> => {
      try {
        return await this.request<unknown[]>(
          `/listings/connections/${connectionId}/taxonomy/categories`,
        );
      } catch (error) {
        // ONLY a 404 means "this API does not have the route". Swallowing every
        // status would turn a 500 or an expired token into "old stack", and the
        // caller would skip with a reason that is not true. A 404 is also what an
        // unknown connection returns, which is why callers pass a world-resolved
        // id rather than a literal.
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    /**
     * The destination's declared description format (ADR-046), or `null` ONLY when
     * the API has no such route.
     *
     * The `null` is a capability probe, not an error channel: a stack whose API is
     * older than the contract builds its publish payload with the PREVIOUS
     * builder, so an assertion there would pass or fail for reasons unrelated to
     * the format. Every other failure propagates.
     */
    descriptionFormat: async (connectionId: string): Promise<DescriptionFormatView | null> => {
      try {
        return await this.request<DescriptionFormatView>(
          `/listings/connections/${connectionId}/description-format`,
        );
      } catch (error) {
        // Same rule as above, and it matters more here: this endpoint is what the
        // ADR-046 assertions gate on, so reclassifying a 500 as "predates the
        // endpoint" would let the whole suite go green against a broken contract.
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
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
    /**
     * Destination-aware duplicate guard (#1837): reports which of the given
     * variant ids already have a listing on `connectionId` — an `Offer`
     * mapping for a marketplace, a `ShopProduct` mapping for a shop. This is
     * the ONLY API surface that reflects a shop publish: `GET /listings`
     * lists `Offer` (marketplace) mappings exclusively, and `GET /products`
     * never surfaces `ShopProduct` rows (a distinct identifier-mapping
     * entityType, keyed by variant id, not product id) — a shop-publish
     * result is otherwise invisible to this API client.
     */
    publishedVariants: (connectionId: string, variantIds: string[]): Promise<string[]> =>
      this.request<{ publishedVariantIds: string[] }>('/listings/published-variants', {
        method: 'POST',
        body: JSON.stringify({ connectionId, variantIds }),
      }).then((response) => response.publishedVariantIds),
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
          salesDocumentBlocked: query?.salesDocumentBlocked,
        })}`,
      ),
    getById: (internalOrderId: string): Promise<OrderRecord> =>
      this.request<OrderRecord>(`/orders/${internalOrderId}`),
    /**
     * Per-health-bucket counts plus the orthogonal sales-document block count
     * (#929/#2100). Deliberately un-scoped here: the endpoint is not
     * self-filterable, so there is nothing to pass.
     */
    statusSummary: (): Promise<OrderHealthSummary> =>
      this.request<OrderHealthSummary>('/orders/status-summary'),
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
    /**
     * Source FA(3) XML document with its decoded text retained — used to grep
     * for specific elements (P_6 / P_8A / P_9A, #1529) rather than just the
     * byte-length proof `getSourceDocument` gives.
     */
    getSourceDocumentText: (invoiceId: string): Promise<RawTextResponse> =>
      this.requestRawText(`/invoices/${invoiceId}/document${buildQuery({ kind: 'source' })}`),
    /**
     * Bulk-issue invoices for a set of orders on one connection (#1355). Fans
     * out over the same single-order issue primitive `issue()` composes.
     */
    bulkIssue: (input: BulkIssueInvoicesInput): Promise<BulkIssueInvoicesResult> =>
      this.request<BulkIssueInvoicesResult>('/invoices/bulk-issue', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    /** Issue a correction (KOR) of an already-issued document (#1241). */
    correct: (invoiceId: string, input: IssueCorrectionInput): Promise<InvoiceRecord> =>
      this.request<InvoiceRecord>(`/invoices/${invoiceId}/correct`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    /** Re-send a rejected document to the tax authority (#1121). */
    resendToKsef: (invoiceId: string): Promise<InvoiceRecord> =>
      this.request<InvoiceRecord>(`/invoices/${invoiceId}/resend-to-ksef`, { method: 'POST' }),
    /** Trigger the provider to email the issued document to the buyer (#1353). */
    sendEmail: (invoiceId: string, input: SendInvoiceEmailInput = {}): Promise<SendInvoiceEmailResult> =>
      this.request<SendInvoiceEmailResult>(`/invoices/${invoiceId}/send-email`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    /** Push an authoritative "paid" state to the provider (#1362). */
    markPaid: (invoiceId: string, input: MarkInvoicePaidInput = {}): Promise<InvoiceRecord> =>
      this.request<InvoiceRecord>(`/invoices/${invoiceId}/mark-paid`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  };

  // ── Invoicing: bank accounts (#1303 follow-up) ─────────────────────────────
  bankAccounts = {
    /** List the connection's provider bank accounts (Transfer invoices). */
    list: (connectionId: string): Promise<InvoicingBankAccount[]> =>
      this.request<InvoicingBankAccount[]>(`/connections/${connectionId}/bank-accounts`),
    /** Mark an account as the provider's own default. Returns 204 (no body). */
    setDefault: (connectionId: string, accountId: string): Promise<void> =>
      this.request<void>(`/connections/${connectionId}/bank-accounts/${accountId}/default`, {
        method: 'POST',
      }),
  };

  // ── Shipments ───────────────────────────────────────────────────────────
  shipments = {
    /**
     * The active shipment for an order, or `null` when it has none.
     *
     * The endpoint answers "no active shipment" with a 404, which `request`
     * turns into a throw — so the declared `| null` was unreachable and every
     * caller's absence-handling branch was dead. Only the 404 is swallowed;
     * any other failure still propagates.
     */
    active: async (orderId: string): Promise<Shipment | null> => {
      try {
        return await this.request<Shipment>(`/shipments/active${buildQuery({ orderId })}`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
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
    /** Cancel a not-yet-dispatched shipment (mutating — attended run only). */
    cancel: (id: string): Promise<Shipment> =>
      this.request<Shipment>(`/shipments/${id}/cancel`, { method: 'POST' }),
    /**
     * Download the carrier handover protocol over a set of dispatched shipments
     * (POST /shipments/bulk/protocol) — binary response, metadata-only like
     * `getLabel`. The service derives the carrier connection from the shipment
     * rows themselves, so the caller only supplies OL shipment ids.
     */
    generateProtocol: (shipmentIds: string[]): Promise<RawResponse> =>
      this.requestRawPost('/shipments/bulk/protocol', { shipmentIds }),
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
      if (query.offset !== undefined) params.set('offset', String(query.offset));
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
     * UI.
     *
     * `MappingOptionsController` USED to hardcode the Allegro<->PrestaShop pair
     * and answer 400 for every other `platformType`, WooCommerce included.
     * #1738 replaced that platform switch with pairing-first, capability-checked
     * resolution keyed on `config.masterCatalogConnectionId`, so a WooCommerce
     * connection now resolves its PAIRED MASTER's option list. The
     * WooCommerce-parity suite asserts that SUCCESS path
     * (`fulfillment-and-mapping-options.spec.ts`), not the closed gap - this
     * comment still described the gap after the spec was rewritten.
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

  // ── Analytics (#2482) ────────────────────────────────────────────────────
  analytics = {
    getSettings: (): Promise<AnalyticsSettingsView> =>
      this.request<AnalyticsSettingsView>('/analytics/settings'),
    updateSettings: (input: UpdateAnalyticsSettingsInput): Promise<void> =>
      this.request<void>('/analytics/settings', {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    getCoverage: (query: AnalyticsRangeQuery): Promise<AnalyticsCoverageView> =>
      this.request<AnalyticsCoverageView>(
        `/analytics/coverage${buildQuery({
          from: query.from,
          to: query.to,
          sourceConnectionId: query.sourceConnectionId,
        })}`,
      ),
    /** POST /analytics/coverage/currency/recalculate — opens a remediation run. */
    recalculateCurrency: (query: AnalyticsRangeQuery): Promise<AnalyticsRemediationRun> =>
      this.request<AnalyticsRemediationRun>('/analytics/coverage/currency/recalculate', {
        method: 'POST',
        body: JSON.stringify(query),
      }),
    /** POST /analytics/coverage/currency/cancel — recovers a run stranded at `in-progress`. */
    cancelCurrencyRun: (): Promise<AnalyticsRemediationRun> =>
      this.request<AnalyticsRemediationRun>('/analytics/coverage/currency/cancel', { method: 'POST' }),
    getCurrencyRunStatus: (runId: string): Promise<AnalyticsRemediationRun> =>
      this.request<AnalyticsRemediationRun>(`/analytics/coverage/currency/status/${runId}`),
    /** GET /analytics/coverage/currency/orders — the detail-currency modal's paginated list. */
    getCurrencyMismatchOrders: (
      query: AnalyticsRangeQuery & { limit?: number; offset?: number },
    ): Promise<Paginated<CurrencyMismatchOrder>> =>
      this.request<Paginated<CurrencyMismatchOrder>>(
        `/analytics/coverage/currency/orders${buildQuery({
          from: query.from,
          to: query.to,
          sourceConnectionId: query.sourceConnectionId,
          limit: query.limit,
          offset: query.offset,
        })}`,
      ),
    /** GET /analytics/coverage/tax/orders — backs detail-tax / detail-novat / detail-postrollout. */
    getTaxCoverageOrders: (
      query: AnalyticsRangeQuery & {
        category: 'tax-a' | 'tax-b' | 'tax-c';
        limit?: number;
        offset?: number;
      },
    ): Promise<Paginated<TaxCoverageOrder>> =>
      this.request<Paginated<TaxCoverageOrder>>(
        `/analytics/coverage/tax/orders${buildQuery({
          category: query.category,
          from: query.from,
          to: query.to,
          sourceConnectionId: query.sourceConnectionId,
          limit: query.limit,
          offset: query.offset,
        })}`,
      ),
    /** POST /analytics/coverage/tax/rerun-backfill — category-C "sync the catalog now". */
    rerunTaxBackfill: (internalOrderIds: string[]): Promise<TaxRerunBackfillResult> =>
      this.request<TaxRerunBackfillResult>('/analytics/coverage/tax/rerun-backfill', {
        method: 'POST',
        body: JSON.stringify({ internalOrderIds }),
      }),
    /** GET /analytics/coverage/matching/orders — the detail-mapping modal's paginated list. */
    getMatchingCoverageOrders: (
      query: AnalyticsRangeQuery & { limit?: number; offset?: number },
    ): Promise<Paginated<ProductMatchingOrder>> =>
      this.request<Paginated<ProductMatchingOrder>>(
        `/analytics/coverage/matching/orders${buildQuery({
          from: query.from,
          to: query.to,
          sourceConnectionId: query.sourceConnectionId,
          limit: query.limit,
          offset: query.offset,
        })}`,
      ),
  };

  // ── Currency settings (#2482 — currency-mismatch fixture) ────────────────
  currencySettings = {
    get: (): Promise<CurrencySettingsView> => this.request<CurrencySettingsView>('/currency-settings'),
    setReportingCurrency: (reportingCurrency: string): Promise<CurrencySettingsView> =>
      this.request<CurrencySettingsView>('/currency-settings/reporting-currency', {
        method: 'PUT',
        body: JSON.stringify({ reportingCurrency }),
      }),
  };
}
