import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { ApiClient, CoreApiClient, PluginApiNamespaces } from '../app/api/api-client';
import { ApiClientProvider } from '../app/api/api-client-provider';
import { ApiError } from '../shared/api/api-error';
import type { Connection } from '../features/connections/api/connections.types';
import type { EanCategoryMatchStreamEvent } from '../features/listings/api/listings.types';
import { createNoopSessionAdapter } from '../shared/auth/noop-session-adapter';
import type { SessionAdapter } from '../shared/auth/session-adapter';
import { SessionProvider } from '../shared/auth/session-provider';
import { PermissionValues, type Session, type SessionUser } from '../shared/auth/session.types';
import { ToastProvider } from '../shared/ui/toast-provider';
import { TooltipProvider } from '../shared/ui/tooltip';
import { LocaleProvider } from '../shared/i18n';
import type { OpenLinkerPlugin } from '../shared/plugins';
import { PluginRegistryProvider } from '../shared/plugins';
import { plugins as inTreePlugins } from '../plugins';
import { IN_TREE_MOCK_API_NAMESPACES, type PluginMockApiNamespacesFactory } from './plugin-mocks';

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  apiClient?: ApiClient;
  route?: string;
  sessionAdapter?: SessionAdapter;
  /**
   * Override the in-tree plugin manifest visible to `usePlatform()` /
   * `usePlatforms()`. Defaults to the production manifest — set this on tests
   * that need to assert registry-absent behavior or inject a fixture plugin.
   */
  plugins?: readonly OpenLinkerPlugin[];
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
  supportedCapabilities: [
    'ProductMaster',
    'InventoryMaster',
    'OrderProcessorManager',
    'OrderSource',
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/**
 * Per-namespace partial of `ApiClient`. Function fields (e.g. `request`)
 * stay as-is; object namespaces become `Partial<...>` so tests can override
 * a subset of methods. The mapped form auto-tracks `PluginApiNamespaces` —
 * when a plugin extends `ApiClient` via declaration merging, the new key is
 * automatically a valid override slot here (#603).
 *
 * Merge order in `createMockApiClient`:
 *   1. core namespace defaults (built inline below)
 *   2. plugin mock-namespace defaults (folded from `IN_TREE_MOCK_API_NAMESPACES`
 *      — see `./plugin-mocks.ts` for the in-tree registry; each plugin owns
 *      its mock factory in `plugins/<name>/<name>.mocks.ts` so `vitest`'s
 *      `vi` never reaches the prod import graph). If two factories contribute
 *      the same namespace key, the later one wins — same fold order as the
 *      production `createApiClient` (api-client.ts).
 *   3. caller overrides (always win — pinned by `plugin-registry.test.ts`
 *      "caller overrides win over plugin contributions")
 *
 * Note on divergence from runtime composition: `createApiClient` iterates the
 * real `plugins` registry and calls `plugin.apiNamespaces(request)` to get the
 * production factories. The test factory uses a parallel test-only registry
 * (`IN_TREE_MOCK_API_NAMESPACES`) because invoking real plugin factories with
 * a stubbed `request` would call through to feature-side fetchers in tests
 * that don't override. Plugin authors register vi-backed mocks in their
 * `*.mocks.ts` file and the aggregator in `./plugin-mocks.ts`.
 */
type DeepPartialApiClient = {
  [K in keyof ApiClient]?: ApiClient[K] extends (...args: never[]) => unknown
    ? ApiClient[K]
    : Partial<ApiClient[K]>;
};

/**
 * Immediately-terminating resolve stream (#2211). `done` with no `result` lines
 * is a real backend outcome (a destination with no EAN matcher), and
 * `catalogueLookupPerformed: false` is the honest reading of it: nothing was
 * looked up, so no row may be blocked on a missing category.
 */
async function* emptyResolveCategoryStream(): AsyncGenerator<
  EanCategoryMatchStreamEvent,
  void,
  undefined
> {
  yield {
    kind: 'done',
    resolvedCount: 0,
    unresolvedCount: 0,
    completion: 'complete',
    catalogueLookupPerformed: false,
  };
}

export function createMockApiClient(
  overrides: DeepPartialApiClient = {},
  mockApiNamespaces: readonly PluginMockApiNamespacesFactory[] = IN_TREE_MOCK_API_NAMESPACES,
): ApiClient {
  const core: CoreApiClient = {
    request: overrides.request ?? vi.fn(),
    requestBlob: overrides.requestBlob ?? vi.fn(),
    requestStream: overrides.requestStream ?? vi.fn(),
    adapters: {
      list: vi.fn().mockResolvedValue([]),
      ...overrides.adapters,
    } as ApiClient['adapters'],
    // #2364. `getSummary` / `listByTrigger` default to the SHAPE the parse
    // layer returns (`{items, droppedCount}`), not a bare array — a mock that
    // returned `[]` would let a component read `.items` as undefined and pass,
    // while the real client never can.
    automations: {
      getVocabulary: vi.fn().mockResolvedValue({
        triggers: [],
        actions: [],
        conditionFields: [],
        amountOps: [],
        holdReasons: [],
        stepBounds: { min: 1, max: 3 },
        runOutcomes: [],
        stepStatuses: [],
        nonFiringReasons: [],
        conditionOutcomes: [],
      }),
      getSummary: vi.fn().mockResolvedValue({ items: [], droppedCount: 0 }),
      listByTrigger: vi.fn().mockResolvedValue({ items: [], droppedCount: 0 }),
      get: vi.fn(),
      create: vi.fn(),
      evaluate: vi.fn(),
      listRuns: vi.fn().mockResolvedValue(null),
      listRunsBySubject: vi.fn().mockResolvedValue(null),
      listRunFeed: vi
        .fn()
        .mockResolvedValue({ runs: [], limit: 50, hasMore: false, recordingAvailable: true, note: null }),
      replace: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
      ...overrides.automations,
    } as ApiClient['automations'],
    aiProviderSettings: {
      getAll: vi.fn().mockResolvedValue({
        activeProvider: 'fake',
        activeUpdatedAt: null,
        activeUpdatedBy: null,
        providers: [
          { provider: 'anthropic', configured: false, source: 'none' },
          { provider: 'openai', configured: false, source: 'none' },
          { provider: 'fake', configured: false, source: 'none' },
        ],
      }),
      setKey: vi.fn().mockResolvedValue(undefined),
      clearKey: vi.fn().mockResolvedValue(undefined),
      setActive: vi.fn().mockResolvedValue(undefined),
      ...overrides.aiProviderSettings,
    } as ApiClient['aiProviderSettings'],
    analytics: {
      getSales: vi.fn().mockResolvedValue({
        headline: {
          revenue: 0,
          currency: 'PLN',
          orderCount: 0,
          averageOrderValue: 0,
          medianOrderValue: 0,
          unitsSold: 0,
          cancelledCount: 0,
          cancelledValue: 0,
          unconvertedCount: 0,
          unconvertedValue: 0,
          unconvertedCurrency: null,
          netRevenue: 0,
          netAverageOrderValue: 0,
          netMedianOrderValue: 0,
          netExcludedCount: 0,
          netExcludedValue: 0,
          trend: [],
        },
        channels: [],
      }),
      getTopProducts: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        unresolvedProductCount: 0,
        coverageGapAvailable: true,
      }),
      getTopProductVariantSales: vi.fn().mockResolvedValue({
        productId: '',
        variants: [],
      }),
      getCoverage: vi.fn().mockResolvedValue({
        categories: [
          { category: 'currency', status: 'open', affectedCount: 0, sampleOrderIds: [] },
          { category: 'tax-a', status: 'open', affectedCount: 0, sampleOrderIds: [] },
          { category: 'tax-b', status: 'open', affectedCount: 0, sampleOrderIds: [] },
          { category: 'tax-c', status: 'open', affectedCount: 0, sampleOrderIds: [] },
          { category: 'product-matching', status: 'open', affectedCount: 0, sampleOrderIds: [] },
        ],
      }),
      recalculateCurrency: vi.fn().mockResolvedValue({
        id: 'ol_remrun_test',
        category: 'currency',
        status: 'in-progress',
        detail: null,
        affectedCount: 0,
        triggeredByUserId: 'user-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      getCurrencyRemediationStatus: vi.fn().mockResolvedValue({
        id: 'ol_remrun_test',
        category: 'currency',
        status: 'in-progress',
        detail: null,
        affectedCount: 0,
        triggeredByUserId: 'user-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      getCurrencyMismatchOrders: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getTaxCoverageOrders: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      rerunTaxBackfill: vi.fn().mockResolvedValue({ scanned: 0, updated: 0 }),
      getProductMatchingOrders: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      ...overrides.analytics,
    } as ApiClient['analytics'],
    analyticsSettings: {
      getSettings: vi.fn().mockResolvedValue({
        displayCurrency: 'EUR',
        displayCurrencySource: 'default',
        rateBasis: 'current',
        includeBackfilledTaxRatesInNetSales: false,
        updatedAt: null,
        updatedByUserId: null,
      }),
      updateSettings: vi.fn().mockResolvedValue(undefined),
      ...overrides.analyticsSettings,
    } as ApiClient['analyticsSettings'],
    analyticsTrust: {
      getTrust: vi.fn().mockResolvedValue({
        generatedAt: '2026-01-01T00:00:00.000Z',
        worstStatus: 'fresh',
        connections: [],
      }),
      getNeedsAttention: vi.fn().mockResolvedValue({
        coverageGaps: [],
        coverageGapsTotalCount: 0,
        stockAtRisk: [],
        stockAtRiskTotalCount: 0,
        failedSyncValue: { count: 0, totalValue: 0, mixedCurrency: false, oldestFailedAt: null },
      }),
      ...overrides.analyticsTrust,
    } as ApiClient['analyticsTrust'],
    auth: {
      login: vi.fn().mockResolvedValue({ access_token: 'mock-jwt-token' }),
      register: vi.fn().mockResolvedValue({ ok: true }),
      forgotPassword: vi.fn().mockResolvedValue({ ok: true }),
      resetPassword: vi.fn().mockResolvedValue({ ok: true }),
      confirmEmail: vi.fn().mockResolvedValue({ ok: true }),
      updateAnalyticsConsent: vi.fn().mockResolvedValue({ ...DEFAULT_TEST_USER }),
      ...overrides.auth,
    } as ApiClient['auth'],
    connections: {
      create: vi.fn().mockResolvedValue(sampleConnection),
      disable: vi.fn().mockResolvedValue({ ...sampleConnection, status: 'disabled' }),
      getBankAccounts: vi.fn().mockResolvedValue([]),
      setDefaultBankAccount: vi.fn().mockResolvedValue(undefined),
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
      rotateWebhookSecret: vi
        .fn()
        .mockResolvedValue({ secret: 'whsec_test', revealedOnce: true, warning: 'Store it now.' }),
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
    currencySettings: {
      get: vi.fn().mockResolvedValue({
        reportingCurrency: 'EUR',
        source: 'default',
        updatedAt: null,
        updatedBy: null,
        supportedCurrencies: ['PLN', 'EUR'],
        rateSource: 'ecb',
        rateDateRule: 'prev-business-day',
        stampedOrders: [],
        coverage: [],
      }),
      setReportingCurrency: vi.fn().mockResolvedValue(undefined),
      ...overrides.currencySettings,
    } as ApiClient['currencySettings'],
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
    fiscalization: {
      // #1909 — empty list default: the normal never-registered state, never a
      // 404 (OpenLinker never asserts an order requires a receipt).
      listForOrder: vi.fn().mockResolvedValue([]),
      register: vi.fn().mockResolvedValue({
        orderId: 'ord_1',
        connectionId: 'conn_fiscal',
        idempotencyKey: 'fiscal:conn_fiscal:ord_1',
        jobId: 'job_1',
        redrivenFromDead: false,
      }),
      // #2526 — default: nobody has asked to register this sale.
      getProgress: vi.fn().mockResolvedValue({
        progress: 'not-requested',
        record: null,
        inFlight: null,
      }),
      reconcile: vi.fn().mockResolvedValue(null),
      ...overrides.fiscalization,
    } as ApiClient['fiscalization'],
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
      ...overrides.inventory,
    } as ApiClient['inventory'],
    invoicing: {
      // #757 — 404 default ⇒ "not-issued" with no network round-trip. NOTE: the
      // default mock connection carries `Invoicing` in neither
      // `enabledCapabilities` nor `supportedCapabilities`, so invoice tests must
      // inject an active connection with `enabledCapabilities: ['Invoicing', …]`
      // via `overrides.connections.list` to render the panel.
      getForOrder: vi
        .fn()
        .mockRejectedValue(
          new ApiError('No invoice for order', 404, { message: 'No invoice for order' }),
        ),
      // #758 — empty paginated list default so the /invoices list page (and any
      // other `invoicing.list` caller) does not hit `undefined` once `list` is
      // added to the InvoicingApi interface. Placed before the spread so an
      // explicit `overrides.invoicing.list` still wins.
      list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
      issue: vi.fn().mockResolvedValue(null),
      retry: vi.fn().mockResolvedValue({ retried: 0, skipped: 0, results: [] }),
      // #1355 — bulk issue default: nothing issued, so the /invoices list page
      // bulk-issue path doesn't hit `undefined` once `bulkIssue` is added.
      bulkIssue: vi.fn().mockResolvedValue({ issued: 0, skipped: 0, failed: 0, results: [] }),
      issueCorrection: vi.fn().mockResolvedValue(null),
      // #1234 — resolves to an empty PDF blob by default so tests that invoke the
      // UPO preview/download path don't hit `undefined`.
      downloadUpo: vi.fn().mockResolvedValue(new Blob([''], { type: 'application/pdf' })),
      // #1228 — resolves to an empty HTML blob by default for FA(3) doc tests.
      downloadDocument: vi
        .fn()
        .mockResolvedValue(new Blob([''], { type: 'text/html' })),
      // #2076 — 409 default ("no content snapshot for this invoice"), mirroring
      // the real endpoint's terminal 409 and the `getForOrder` 404 precedent
      // above. This puts correction-flow tests on the picker's manual-entry
      // FALLBACK deliberately rather than by accident; a test that wants the
      // line picker overrides `invoicing.getContent` with real lines.
      getContent: vi
        .fn()
        .mockRejectedValue(
          new ApiError('No content snapshot', 409, { message: 'No content snapshot' }),
        ),
      ...overrides.invoicing,
    } as ApiClient['invoicing'],
    operationalSettings: {
      get: vi.fn().mockResolvedValue({
        catalogueSweepBudget: {
          value: 500,
          source: 'default',
          recommendedMax: 2000,
          recommendedReason: 'A 2000-item run takes about 184 s against a 1200 s window.',
          absoluteMax: 20000,
          absoluteReason: 'A sanity backstop against a mistyped value.',
          aboveRecommended: false,
        },
        inventorySweepBudget: {
          value: 100,
          source: 'default',
          recommendedMax: 2000,
          recommendedReason: 'Headroom is the point; 2000 matches the catalogue sweep.',
          absoluteMax: 20000,
          absoluteReason: 'The same sanity backstop as the catalogue sweep.',
          aboveRecommended: false,
        },
        sweepPageSize: {
          value: 100,
          source: 'default',
          recommendedMax: 100,
          recommendedReason: "100 is PrestaShop's own collection page size.",
          absoluteMax: 500,
          absoluteReason: 'Ids are joined into a query string, so this drives URL length.',
          aboveRecommended: false,
        },
        deletionAuditBudget: {
          value: 100,
          source: 'default',
          recommendedMax: 2000,
          recommendedReason: 'A 41.7-day audit cycle at the default is what this knob is for.',
          absoluteMax: 20000,
          absoluteReason: 'The same sanity backstop as the catalogue sweep.',
          aboveRecommended: false,
        },
        deletionAuditCadence: { value: '0 * * * *', source: 'default' },
        deletionAuditAlwaysEnabled: true,
        cadenceAppliesAt: 'next-scheduler-start',
        updatedAt: null,
        updatedBy: null,
        adapterClampNote:
          'A page size above what a specific adapter can send is clamped where the request is built.',
        bounds: {
          catalogueSweepBudget: {
            min: 1,
            recommendedMax: 2000,
            absoluteMax: 20000,
            default: 500,
            envVar: 'OL_PRODUCT_SYNC_PAGE_LIMIT',
          },
          inventorySweepBudget: {
            min: 1,
            recommendedMax: 2000,
            absoluteMax: 20000,
            default: 100,
            envVar: 'OL_INVENTORY_SYNC_PAGE_LIMIT',
          },
          sweepPageSize: {
            min: 1,
            recommendedMax: 100,
            absoluteMax: 500,
            default: 100,
            envVar: 'OL_SWEEP_PAGE_SIZE',
          },
          deletionAuditBudget: {
            min: 1,
            recommendedMax: 2000,
            absoluteMax: 20000,
            default: 100,
            envVar: 'OL_MASTER_PRODUCT_RECONCILE_PAGE_LIMIT',
          },
        },
      }),
      update: vi.fn().mockResolvedValue(undefined),
      ...overrides.operationalSettings,
    } as ApiClient['operationalSettings'],
    orders: {
      list: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      }),
      statusSummary: vi.fn().mockResolvedValue({
        total: 0,
        awaitingMapping: 0,
        needsAttention: 0,
        synced: 0,
        awaitingDispatch: 0,
      }),
      // #2310 — every phase count defaults to 0 so the chip row renders empty
      // (a zero-count chip is hidden); a test that cares overrides this.
      lifecycleSummary: vi.fn().mockResolvedValue({
        total: 0,
        cancelled: 0,
        vendorAuthoritative: 0,
        delivered: 0,
        inTransit: 0,
        fulfillmentFailed: 0,
        held: 0,
        amending: 0,
        blocked: 0,
        ready: 0,
      }),
      getById: vi.fn().mockResolvedValue(null),
      retryDestination: vi.fn().mockResolvedValue({
        internalOrderId: '',
        destinationConnectionId: '',
        jobId: '',
        jobType: '',
      }),
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
      // #464 — default to a 422 (capability missing) so component tests that
      // don't override fall through to the soft "live data unavailable"
      // branch rather than a real network round-trip.
      getMarketplaceOffer: vi
        .fn()
        .mockRejectedValue(new ApiError('Adapter does not support live offer reading', 422, null)),
      updateOfferFields: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
      // ADR-046: the frontend holds no default format, so a component that
      // mounts a description editor renders a disabled placeholder until this
      // read resolves. Defaulting it permissively here keeps every existing
      // component test exercising the editor rather than the placeholder; a
      // test that cares about a NARROW destination overrides it.
      getDescriptionFormat: vi.fn().mockResolvedValue({
        shape: 'html',
        allowedTags: ['h1', 'h2', 'h3', 'p', 'b', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'br'],
        allowedAttributes: { a: ['href'] },
        contentModel: null,
        rewrites: [],
        requiresBlockOpener: false,
        selfClosingVoids: false,
        maxBytes: null,
        declared: true,
        resolvedVia: 'OfferManager',
      }),
      createOffer: vi.fn().mockResolvedValue({ jobId: 'job-1', offerCreationRecordId: 'rec-1' }),
      // Tests that render the tracker must override with a full-shape response — the `null`
      // default mirrors the `getById` pattern and forces explicit test setup.
      getOfferCreationStatus: vi.fn().mockResolvedValue(null),
      // #1044 — shop publish. Submit mocks return canned ids; status mocks
      // return `null` (like `getById`) so tests that render a tracker must
      // override with a full-shape response.
      shopPublish: vi
        .fn()
        .mockResolvedValue({ jobId: 'job-sp-1', listingCreationRecordId: 'sp-rec-1' }),
      getShopPublishStatus: vi.fn().mockResolvedValue(null),
      // #1834 — default to "no shop categories" so the shop category picker
      // renders its empty state in tests that don't override.
      browseShopCategories: vi.fn().mockResolvedValue([]),
      // #1835 — default to "no global attributes/terms" so the shop attribute
      // picker renders its empty state in tests that don't override.
      listShopAttributes: vi.fn().mockResolvedValue([]),
      listShopAttributeTerms: vi.fn().mockResolvedValue([]),
      shopPublishBulk: vi.fn().mockResolvedValue({ batchId: 'sp-batch-1', items: [] }),
      getBulkShopPublishBatch: vi.fn().mockResolvedValue(null),
      getSellerPolicies: vi.fn().mockResolvedValue({
        deliveryPolicies: [],
        returnPolicies: [],
        warranties: [],
        impliedWarranties: [],
      }),
      // #1531 — default to "no producers" so the Erli wizard's producer picker
      // renders its empty state in tests that don't override.
      getResponsibleProducers: vi.fn().mockResolvedValue({ responsibleProducers: [] }),
      // #1530 — default to "no delivery price lists" so the Erli wizard's
      // delivery-price-list picker renders its empty state in tests that
      // don't override.
      getDeliveryPriceLists: vi.fn().mockResolvedValue({ deliveryPriceLists: [] }),
      // #410 — default to "no parameters" so the wizard's category step
      // renders the friendly empty state in tests that don't override.
      getCategoryParameters: vi.fn().mockResolvedValue({ parameters: [] }),
      // #1752 — default to an empty breadcrumb so the listing drawer falls back
      // to the raw category id in tests that don't exercise category resolution.
      getCategoryPath: vi.fn().mockResolvedValue({ path: [] }),
      // #635 — default the Allegro catalog match to "no_match" so tests
      // that don't exercise the catalog-prefill flow render the wizard
      // without a panel and without a real network call. `getCatalogProduct`
      // is non-nullable on the contract, so the default mock rejects with
      // a 422 (matches the `getMarketplaceOffer` convention from #464) and
      // forces tests that exercise the ambiguous-pick branch to override.
      findProductsByBarcode: vi.fn().mockResolvedValue({ kind: 'no_match' }),
      getCatalogProduct: vi
        .fn()
        .mockRejectedValue(
          new ApiError('Adapter does not support catalog product reading', 422, null),
        ),
      // #632 — default to a no-match outcome so existing wizard tests that
      // don't opt in behave as if the BE returned "manual / null". Tests that
      // exercise the auto-prefill override this with the desired shape.
      resolveCategory: vi.fn().mockResolvedValue({
        allegroCategoryId: null,
        method: 'manual',
      }),
      // #2211 - default to a stream that terminates immediately with no
      // per-variant results, the shape a destination without an EAN matcher
      // produces. Tests that exercise the Resolve step override it.
      resolveCategoriesStream: vi.fn(() => emptyResolveCategoryStream()),
      ...overrides.listings,
    } as ApiClient['listings'],
    mailerSettings: {
      get: vi.fn().mockResolvedValue({
        transport: 'console',
        smtpHost: null,
        smtpPort: null,
        smtpSecure: false,
        fromAddress: null,
        smtpPasswordConfigured: false,
        updatedAt: null,
        updatedBy: null,
      }),
      update: vi.fn().mockResolvedValue(undefined),
      setCredentials: vi.fn().mockResolvedValue(undefined),
      clearCredentials: vi.fn().mockResolvedValue(undefined),
      ...overrides.mailerSettings,
    } as ApiClient['mailerSettings'],
    mcpTokens: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(undefined),
      revoke: vi.fn().mockResolvedValue(undefined),
      ...overrides.mcpTokens,
    } as ApiClient['mcpTokens'],
    posthogSettings: {
      get: vi.fn().mockResolvedValue({
        enabled: false,
        region: 'eu',
        customHost: null,
        autocapture: false,
        sessionRecording: false,
        productEventsEnabled: false,
        enabledEventGroups: [],
        apiKeyConfigured: false,
        wouldOverrideEnv: false,
        overriddenEnvVars: [],
        updatedAt: null,
        updatedBy: null,
      }),
      update: vi.fn().mockResolvedValue(undefined),
      setCredentials: vi.fn().mockResolvedValue(undefined),
      clearCredentials: vi.fn().mockResolvedValue(undefined),
      ...overrides.posthogSettings,
    } as ApiClient['posthogSettings'],
    products: {
      list: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      }),
      getById: vi.fn().mockResolvedValue(null),
      // #464 — quiet 404 default so the listing-detail page's variant
      // enrichment renders the bare ID without an error in tests that don't
      // care about the SKU/EAN tags.
      getVariant: vi.fn().mockRejectedValue(new ApiError('Variant not found', 404, null)),
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
      archive: vi.fn().mockResolvedValue(null),
      revert: vi.fn().mockResolvedValue(null),
      render: vi
        .fn()
        .mockResolvedValue({ templateId: '', version: 1, systemPrompt: '', userPrompt: '' }),
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
      getOrderStateMappings: vi.fn().mockResolvedValue([]),
      upsertOrderStateMappings: vi.fn().mockResolvedValue([]),
      getMappingOptions: vi.fn().mockResolvedValue([]),
      getCategoryPath: vi.fn().mockResolvedValue([]),
      getRoutingRules: vi.fn().mockResolvedValue([]),
      replaceRoutingRules: vi.fn().mockResolvedValue([]),
      getRoutingCandidates: vi.fn().mockResolvedValue([]),
      getAttributeRules: vi.fn().mockResolvedValue([]),
      upsertAttributeRule: vi.fn().mockResolvedValue(undefined),
      deleteAttributeRule: vi.fn().mockResolvedValue(undefined),
      ...overrides.mappings,
    } as ApiClient['mappings'],
    fulfillmentAuthority: {
      getStatus: vi.fn().mockResolvedValue(null),
      applyPreset: vi.fn().mockResolvedValue(null),
      ...overrides.fulfillmentAuthority,
    } as ApiClient['fulfillmentAuthority'],
    // #2411. The default answers the SHAPE the parse layer returns (a page
    // object), never a bare array — a mock returning `[]` would let the panel
    // read `.works` as undefined and pass, while the real client never can.
    fulfillment: {
      listByOrder: vi.fn().mockResolvedValue({ works: [], total: 0, limit: 50, offset: 0 }),
      // #2410. `list` and `get` are defaulted HERE rather than in the specs
      // that need them: every worklist page test calls `list`, and an absent
      // member fails as `apiClient.fulfillment.list is not a function` from
      // inside a render — an inscrutable crash that reads as a defect in the
      // page rather than as a missing mock.
      list: vi.fn().mockResolvedValue({ works: [], total: 0, limit: 25, offset: 0 }),
      get: vi.fn().mockResolvedValue(null),
      applyAction: vi.fn().mockResolvedValue(null),
      ...overrides.fulfillment,
    } as ApiClient['fulfillment'],
    salesDocumentRules: {
      listRules: vi.fn().mockResolvedValue([]),
      createRule: vi.fn().mockResolvedValue(null),
      deleteRule: vi.fn().mockResolvedValue(undefined),
      listCountryDefaults: vi.fn().mockResolvedValue([]),
      upsertCountryDefault: vi.fn().mockResolvedValue(null),
      deleteCountryDefault: vi.fn().mockResolvedValue(undefined),
      listThresholds: vi.fn().mockResolvedValue([]),
      getTemplate: vi.fn().mockResolvedValue(null),
      adoptTemplate: vi.fn().mockResolvedValue([]),
      listConfiguredCountries: vi.fn().mockResolvedValue([]),
      acknowledgeNoDocument: vi.fn().mockResolvedValue({
        country: '',
        acknowledgedAt: '2026-01-01T00:00:00.000Z',
      }),
      clearAcknowledgment: vi.fn().mockResolvedValue(undefined),
      listMarkets: vi.fn().mockResolvedValue({
        windowDays: 30,
        since: '2026-01-01T00:00:00.000Z',
        markets: [],
      }),
      ...overrides.salesDocumentRules,
    } as ApiClient['salesDocumentRules'],
    // The default is the healthy-but-empty deployment: no returns, and returns
    // ingestion IS configured — so a test that renders the list without opting
    // in gets the neutral "no returns yet" branch rather than the
    // configuration claim, which no test should assert by accident.
    returns: {
      list: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
        counts: { total: 0, orphan: 0, attributed: 0 },
        droppedCount: 0,
      }),
      getIngestionAvailability: vi
        .fn()
        .mockResolvedValue({ configured: true, connectionIds: [] }),
      // #2383 — the order detail page reads this on every render. Defaulted to
      // the no-returns case so every existing order test keeps its behaviour.
      listReturnEventsForOrder: vi.fn().mockResolvedValue([]),
      ...overrides.returns,
    } as ApiClient['returns'],
    shipments: {
      list: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      }),
      generateLabel: vi.fn().mockResolvedValue({ kind: 'omp_fulfilled' }),
      cancel: vi.fn().mockResolvedValue({
        id: 'ol_shipment_1',
        status: 'cancelled',
      }),
      notifyDispatched: vi.fn().mockResolvedValue({
        shipmentId: 'ol_shipment_1',
        outcome: 'notified',
        source: 'ok',
        destinations: [],
      }),
      downloadLabel: vi.fn().mockResolvedValue(new Blob([new Uint8Array([0x25, 0x50])])),
      bulkGenerateLabels: vi.fn().mockResolvedValue({ results: [] }),
      downloadProtocol: vi.fn().mockResolvedValue(new Blob([new Uint8Array([0x25, 0x50])])),
      ...overrides.shipments,
    } as ApiClient['shipments'],
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
      lookupJobForWebhookEvent: vi.fn().mockResolvedValue(null),
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
    users: {
      list: vi.fn().mockResolvedValue({ users: [], total: 0 }),
      approve: vi.fn().mockResolvedValue(undefined),
      reject: vi.fn().mockResolvedValue(undefined),
      updateRole: vi.fn().mockResolvedValue(undefined),
      deactivate: vi.fn().mockResolvedValue(undefined),
      reactivate: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      ...overrides.users,
    } as ApiClient['users'],
    system: {
      getConfig: vi.fn().mockResolvedValue({ demoMode: false }),
      ...overrides.system,
    } as ApiClient['system'],
  };

  // Fold plugin mock defaults, layering caller overrides per namespace. Caller
  // overrides always win (pinned in `plugin-registry.test.ts`). A caller may
  // also pass an override for a plugin namespace that no in-tree mock factory
  // contributes — applied verbatim below.
  const pluginDefaults: Partial<PluginApiNamespaces> = {};
  for (const factory of mockApiNamespaces) {
    Object.assign(pluginDefaults, factory());
  }

  const pluginNamespaces: Record<string, unknown> = {};
  const overridesRecord = overrides as Record<string, unknown>;
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(pluginDefaults)) {
    seen.add(key);
    pluginNamespaces[key] = {
      ...(value as object),
      ...((overridesRecord[key] as object | undefined) ?? {}),
    };
  }
  for (const [key, value] of Object.entries(overridesRecord)) {
    if (seen.has(key) || key in core) continue;
    pluginNamespaces[key] = value;
  }

  return { ...core, ...pluginNamespaces } as ApiClient;
}

/**
 * Default authenticated test session — an `admin`, which the backend's
 * `ROLE_PERMISSIONS` grants **every** permission (`admin: PermissionValues`).
 * Derived from `PermissionValues` rather than hand-listed (#1826): the
 * previous hand-maintained array had silently drifted, omitting
 * `customers:read` / `shipments:read` / `shipments:write` even though a real
 * admin session carries them — so any test asserting an affordance gated on a
 * missing permission was passing for the wrong reason. Deriving it means a
 * newly-added permission can't drift out of this fixture again.
 */
const DEFAULT_TEST_USER: SessionUser = {
  id: 'user_1',
  username: 'admin',
  email: 'admin@example.com',
  role: 'admin',
  permissions: [...PermissionValues],
  analyticsConsent: true,
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

/**
 * Replaces `window.localStorage` with one that throws on every access, to
 * exercise the private-browsing / blocked-storage branches. Returns a restore
 * function — call it in `afterEach`.
 *
 * Why not `vi.spyOn(...)`: jsdom's `localStorage` is a Proxy whose set trap
 * writes *stored items*, so both `Storage.prototype` and instance spies are
 * order-dependent — they stop intercepting once another test in the same file
 * restores mocks, silently turning "should not throw" assertions vacuous
 * (#1884). Swapping the whole object out is deterministic.
 */
export function stubUnavailableLocalStorage(): () => void {
  const original = window.localStorage;
  const unavailable = (): never => {
    throw new Error('storage disabled');
  };

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: unavailable,
      getItem: unavailable,
      key: unavailable,
      length: 0,
      removeItem: unavailable,
      setItem: unavailable,
    },
  });

  return () => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: original });
  };
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult {
  const {
    apiClient = createMockApiClient(),
    route = '/',
    sessionAdapter = createNoopSessionAdapter(),
    plugins = inTreePlugins,
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
      </MemoryRouter>
    ),
    ...renderOptions,
  });
}
