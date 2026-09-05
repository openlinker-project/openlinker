/**
 * API response types
 *
 * Neutral, hand-maintained mirrors of the OpenLinker REST response shapes the
 * E2E suite consumes. Kept deliberately minimal — only the fields the tests
 * read — and colocated so specs never reach into `apps/web` or `libs/*` types
 * (this package is isolated from the rest of the monorepo).
 *
 * @module api
 */

export interface LoginResponse {
  access_token: string;
}

// ── Access control (demo mode, registration, RBAC) ──────────────────────────

/** GET /system/config (public) — server-driven runtime flags read at startup. */
export interface SystemConfig {
  /** True when OL_DEMO_MODE=true is set in the API's environment. */
  demoMode: boolean;
  /** Demo-only third-party integration config (present only in demo mode). */
  demoIntegrations?: Record<string, unknown>;
}

/**
 * GET /auth/me — the authenticated user's role + derived permissions. The
 * endpoint lives under `/auth/me` (not `/me`); the client prepends `/v1`.
 */
export interface MeResponse {
  id: string;
  username: string;
  email: string | null;
  role: string;
  /** Permissions derived from the role (`{resource}:{action}`), e.g. `orders:read`. */
  permissions: string[];
}

/** POST /auth/register (public) request body. */
export interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

/** A single row of GET /users (admin only). */
export interface UserSummary {
  id: string;
  username: string;
  email: string | null;
  role: string;
  status: string;
  createdAt?: string;
}

/** GET /users (admin only) response — note the `users` key, not `items`. */
export interface UserListResponse {
  users: UserSummary[];
  total: number;
}

/** POST /users/:id/approve request body — the role to assign on approval. */
export interface ApproveUserInput {
  role: string;
}

/** Optional server-side filter/pagination for GET /users. */
export interface ListUsersQuery {
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface ServiceHealth {
  status: 'ok' | 'warning' | 'error';
  message?: string;
}

export interface InternalHealthResponse {
  status: 'ok' | 'error';
  version?: string;
  services?: Record<string, ServiceHealth>;
  timestamp?: string;
}

export interface Connection {
  id: string;
  name: string;
  platformType: string;
  status: 'active' | 'disabled' | 'error' | 'needs_reauth';
  config: Record<string, unknown> | null;
  credentialsBacked: boolean;
  adapterKey: string | null;
  enabledCapabilities: string[];
  supportedCapabilities: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ExternalIdMapping {
  externalId: string;
  platformType: string;
  connectionId: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string | null;
  attributes: Record<string, unknown> | null;
  ean: string | null;
  gtin: string | null;
  price: number | null;
  externalIds?: ExternalIdMapping[];
}

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  price: number | null;
  currency: string | null;
  /**
   * Master description, stored as raw HTML (#2201). Present on the list and
   * detail reads; `null` when the source shop carries none.
   */
  description?: string | null;
  /**
   * How many variants the product has, on the LIST read.
   *
   * The list projection deliberately omits `variants` (pinned by
   * `products.controller.spec.ts`), so this is the only variant fact available
   * without a second request per product - which matters for a spec that needs
   * to pick, say, a single-variant product out of a page.
   */
  variantCount?: number;
  /** Only on the DETAIL read (`GET /products/:id`), never on the list. */
  variants?: ProductVariant[];
  externalIds?: ExternalIdMapping[];
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface InventoryItem {
  id: string;
  productId: string;
  productVariantId: string | null;
  availableQuantity: number;
  reservedQuantity: number;
  locationId: string | null;
  updatedAt: string;
}

export interface InventoryAvailability {
  productVariantId: string;
  totalAvailable: number;
  locationCount: number;
}

export interface InventoryAvailabilityResponse {
  items: InventoryAvailability[];
}

export interface OfferCreationSummary {
  status: string;
  externalOfferId?: string | null;
}

/**
 * A submitted section-tagged category parameter, as persisted on the
 * offer-creation request snapshot (`overrides.parameters`, #1071).
 */
export interface SubmittedOfferParameter {
  id: string;
  values?: string[];
  valuesIds?: string[];
  rangeValue?: { from: string; to: string };
  section: CategoryParameterSection;
}

export interface OfferCreationRequestOverrides {
  title?: string;
  description?: string | null;
  categoryId?: string;
  productCardId?: string;
  imageUrls?: string[] | null;
  /** Submitted neutral category parameters (#1071). */
  parameters?: SubmittedOfferParameter[];
  /** Un-modeled platform knobs only (policy ids, etc.) — NOT category params. */
  platformParams?: Record<string, unknown>;
}

/** Persisted snapshot of the create-offer request payload (schemaVersion 1). */
export interface OfferCreationRequestPayload {
  schemaVersion: number;
  internalVariantId: string;
  stock: number;
  publishImmediately: boolean;
  price?: { amount: number; currency: string };
  overrides?: OfferCreationRequestOverrides;
}

/** GET /listings/connections/:connectionId/offers/creation/:recordId */
export interface OfferCreationStatus {
  id: string;
  connectionId: string;
  internalVariantId: string;
  status: string;
  externalOfferId: string | null;
  request?: OfferCreationRequestPayload | null;
}

export interface BulkBatchRecordSummary {
  id: string;
  internalVariantId: string;
  status: string;
  externalOfferId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Structured failure reasons; populated only when `status === 'failed'`. */
  errors: Array<{ code?: string; field?: string; message?: string }> | null;
}

/** GET /listings/bulk-create/:batchId */
export interface BulkBatchSummary {
  id: string;
  connectionId: string;
  status: string;
  totalCount: number;
  succeededCount: number;
  failedCount: number;
  records: BulkBatchRecordSummary[];
}

export interface OfferMapping {
  id: string;
  entityType: string;
  internalId: string;
  externalId: string;
  platformType: string;
  connectionId: string;
  context: Record<string, unknown> | null;
  offerCreation?: OfferCreationSummary;
  linkedProductId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderSyncStatus {
  destinationConnectionId: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  syncedAt: string | null;
  externalOrderId: string | null;
  externalOrderNumber: string | null;
  error: string | null;
}

export interface OrderRecord {
  internalOrderId: string;
  customerId: string | null;
  sourceConnectionId: string;
  sourceEventId: string | null;
  orderSnapshot: Record<string, unknown>;
  syncStatus: OrderSyncStatus[];
  recordStatus: 'ready' | 'awaiting_mapping' | 'source_deleted';
  createdAt: string;
  updatedAt: string;
  /**
   * Why OpenLinker issued no fiscal document for this order (#2100, ADR-041
   * decision 11). `null` = nothing blocking. Optional so the suite stays green
   * against an API that predates the field.
   */
  salesDocumentBlockReason?: string | null;
  /** The routing reason paired with a `'unresolved-routing'` block (ADR-041 §107). */
  salesDocumentUnresolvedReason?: string | null;
  /** PII-free elaboration of the block reason (ids and counts only). */
  salesDocumentBlockDetail?: string | null;
}

/**
 * `GET /orders/status-summary` (#929, extended #2100).
 *
 * The five health buckets partition the set, so `total` equals their sum.
 * `salesDocumentBlocked` rides along and is deliberately NOT a member — a blocked
 * order is also in exactly one health bucket — so it must never be added in.
 */
export interface OrderHealthSummary {
  total: number;
  sourceDeleted: number;
  awaitingMapping: number;
  needsAttention: number;
  synced: number;
  awaitingDispatch: number;
  salesDocumentBlocked?: number;
}

/** POST /invoices — server assembles lines/buyer from the order. */
/** Scheme-tagged buyer tax id; presence drives B2B (company), absence B2C. */
export interface BuyerTaxIdInput {
  scheme: string;
  value: string;
}

export interface IssueInvoiceInput {
  connectionId: string;
  orderId: string;
  buyerTaxId?: BuyerTaxIdInput;
  documentType?: string;
  idempotencyKey?: string;
}

export interface InvoiceRecord {
  id: string;
  connectionId: string;
  orderId: string;
  providerType: string;
  documentType: string;
  status: 'pending' | 'issuing' | 'issued' | 'failed';
  providerInvoiceId: string | null;
  providerInvoiceNumber: string | null;
  regulatoryStatus:
    | 'not-applicable'
    | 'submitted'
    | 'cleared'
    | 'accepted'
    | 'rejected';
  clearanceReference: string | null;
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceOfferPrice {
  amount: string;
  currency: string;
}

export interface MarketplaceOfferCategory {
  id: string;
  name?: string;
}

/**
 * A filled, section-tagged parameter on the live marketplace offer (#1482 —
 * present only when the running API exposes the extended MarketplaceOffer
 * read model; older stacks omit the field entirely).
 */
export interface MarketplaceOfferParameter {
  id: string;
  name?: string;
  values?: string[];
  valuesIds?: string[];
  rangeValue?: { from: string; to: string };
  section: CategoryParameterSection;
}

/** Product-set linkage for catalog-grouped offers (#1482). */
export interface MarketplaceOfferProductSetItem {
  productId?: string;
  quantity?: number;
}

/** Adapter-fetched live offer (GET /listings/:id/offer). */
export interface MarketplaceOffer {
  externalId: string;
  title: string;
  description?: string;
  imageUrl?: string;
  price: MarketplaceOfferPrice;
  availableQuantity: number;
  status: string;
  category?: MarketplaceOfferCategory;
  marketplaceUrl?: string;
  endsAt?: string;
  parameters?: MarketplaceOfferParameter[];
  productSet?: MarketplaceOfferProductSetItem[];
}

export type CategoryParameterSection = 'offer' | 'product';

/** A single category parameter definition (GET .../categories/:id/parameters). */
export interface CategoryParameter {
  id: string;
  name: string;
  type: string;
  required: boolean;
  unit?: string;
  section: CategoryParameterSection;
}

export interface CategoryParametersResponse {
  parameters: CategoryParameter[];
}

export interface InvoiceTaxId {
  scheme: string;
  value: string;
}

export interface InvoiceParty {
  name: string;
  taxId: InvoiceTaxId | null;
  address?: Record<string, unknown>;
}

export interface InvoiceContentLine {
  name: string;
  quantity: number;
  unitNet: string;
  taxRate: string;
  net: string;
  tax: string;
  gross: string;
}

export interface InvoiceTaxBreakdown {
  rate: string;
  net: string;
  tax: string;
  gross: string;
}

export interface InvoiceContentTotals {
  net: string;
  tax: string;
  gross: string;
}

/** Amount/tax surface of an issued document (GET /invoices/:id/content). */
export interface IssuedDocumentContent {
  seller: InvoiceParty | null;
  buyer: InvoiceParty;
  lines: InvoiceContentLine[];
  taxBreakdown: InvoiceTaxBreakdown[];
  totals: InvoiceContentTotals;
  currency: string;
  issueDate: string | null;
  saleDate: string | null;
  payment?: { method: string; paidAt: string | null } | null;
}

export type ShipmentStatus =
  | 'draft'
  | 'generated'
  | 'dispatched'
  | 'in-transit'
  | 'delivered'
  | 'failed'
  | 'cancelled';

/**
 * Mirrors `ShipmentResponseDto`. Note the WRITE-ONLY fields: `GenerateLabelInput`
 * accepts `cod` and `insuredValue`, but the read model exposes neither, so no
 * spec can assert that a COD amount or a declared value actually reached the
 * carrier - a success-path assertion on a COD/insured dispatch would pass
 * identically with those arguments deleted. The real coverage for those flows is
 * the REJECTION path (a malformed amount 400s, an unsupported carrier 502s).
 * Closing the gap needs the fields on the API response DTO, which is outside
 * this package.
 */
export interface Shipment {
  id: string;
  orderId: string;
  connectionId: string;
  shippingMethod: string;
  status: ShipmentStatus;
  providerShipmentId: string | null;
  paczkomatId: string | null;
  sourceDeliveryMethodId: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  labelPdfRef: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Decimal-string money descriptor shared by COD and insured-value inputs. */
export interface ShippingMoneyInput {
  amount: string;
  currency: string;
}

export interface GenerateLabelInput {
  sourceConnectionId: string;
  sourceDeliveryMethodId?: string;
  orderId: string;
  deliveryIntent?: 'pickup_point' | 'address';
  paczkomatId?: string;
  recipient?: Record<string, unknown>;
  parcel?: Record<string, unknown>;
  cod?: ShippingMoneyInput;
  /** Declared value to insure the parcel for (#1542). Carriers that don't support insurance ignore it. */
  insuredValue?: ShippingMoneyInput;
}

export interface DispatchResult {
  kind: 'dispatched' | 'omp_fulfilled';
  shipment?: Shipment;
}

/** A raw (binary) response — used for label PDF / UPO retrieval. */
export interface RawResponse {
  status: number;
  ok: boolean;
  contentType: string | null;
  byteLength: number;
}

export type SyncJobStatus = 'queued' | 'running' | 'succeeded' | 'dead';

export interface SyncJob {
  id: string;
  jobType: string;
  connectionId: string;
  status: SyncJobStatus;
  outcome: 'ok' | 'business_failure' | null;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncJobListQuery {
  connectionId?: string;
  jobType?: string;
  status?: SyncJobStatus;
  /** Server maximum is 100 (`ListSyncJobsQueryDto.limit` is `@Max(100)`). */
  limit?: number;
  offset?: number;
}

export interface SyncJobListResponse {
  items: SyncJob[];
  total: number;
  limit: number;
  offset: number;
}

export interface EnqueueSyncJobInput {
  connectionId: string;
  jobType: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface EnqueueSyncJobResponse {
  jobId: string;
  jobType?: string;
  connectionId?: string;
  isExisting?: boolean;
}

/**
 * Response of `POST /connections/:id/webhooks/secret/rotate` — the plaintext
 * webhook secret, revealed exactly once. The E2E webhook spec captures it to
 * sign an inbound request the way the external platform would.
 */
export interface RotateWebhookSecretResponse {
  secret: string;
  revealedOnce: boolean;
  warning: string;
}

/**
 * Result of firing a raw inbound webhook at `/webhooks/:provider/:connectionId`
 * (version-neutral ingress — no `/v1` prefix). Status + parsed body only.
 */
export interface InboundWebhookResult {
  status: number;
  ok: boolean;
  body: unknown;
}

/** Filters for `GET /webhook-deliveries`. */
export interface ListWebhookDeliveriesQuery {
  provider?: string;
  connectionId?: string;
  eventType?: string;
  status?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

/**
 * A row from `GET /webhook-deliveries` (summary view — no payload). The webhook
 * spec asserts on `signatureValid`, `status`, and the `downstream*` fields that
 * capture the enqueue outcome.
 */
export interface WebhookDeliverySummary {
  id: string;
  eventId: string;
  provider: string;
  connectionId: string;
  eventType: string | null;
  objectType: string | null;
  externalId: string | null;
  receivedAt: string;
  signatureValid: boolean | null;
  dedupResult: string | null;
  status: string;
  rejectionReason: string | null;
  publishedMessageId: string | null;
  downstreamJobId: string | null;
  downstreamJobType: string | null;
  dlqReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoutingRule {
  id: string;
  sourceConnectionId: string;
  sourceDeliveryMethodId: string;
  processorKind: string;
  processorConnectionId: string;
}

export interface RoutingRuleInput {
  sourceDeliveryMethodId: string;
  processorKind: string;
  processorConnectionId: string;
}

/**
 * PUT /connections/:connectionId/mappings/categories/:sourceCategoryId body —
 * the destination (Allegro) category a source (PrestaShop) category maps to.
 * Mirrors the FE `upsertCategoryMapping` payload.
 */
export interface CategoryMappingInput {
  allegroCategoryId: string;
  allegroCategoryName: string;
  allegroCategoryPath?: string;
}

export interface ConnectionFilters {
  platformType?: string;
  status?: string;
}

/** POST /connections request body. Exactly one of `credentials`/`credentialsRef` is required. */
export interface CreateConnectionInput {
  name: string;
  platformType: string;
  config: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  credentialsRef?: string;
  adapterKey?: string;
  enabledCapabilities?: string[];
}

/** PATCH /connections/:id request body — all fields optional. */
export interface UpdateConnectionInput {
  name?: string;
  status?: 'active' | 'disabled' | 'error';
  config?: Record<string, unknown>;
  adapterKey?: string;
  enabledCapabilities?: string[];
}

/** POST /connections/:id/webhooks/install response (#583). */
export interface InstallWebhooksResult {
  webhooksConfigured: boolean;
  testPingTriggered: boolean;
  warning?: string;
}

export interface ListProductsQuery {
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ListListingsQuery {
  connectionId?: string;
  platformType?: string;
  internalId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ListOrdersQuery {
  sourceConnectionId?: string;
  syncStatus?: string;
  limit?: number;
  offset?: number;
  /**
   * Sales-document block filter (#2100). An independent axis that composes with
   * `health` rather than competing with it. Typed `boolean | string` so a spec can
   * deliberately send a stray value and assert the 400 — a silent unfiltered list
   * would be the worse failure for a filter.
   */
  salesDocumentBlocked?: boolean | string;
}

export interface ListInvoicesQuery {
  status?: string;
  connectionId?: string;
  regulatoryStatus?: string;
  limit?: number;
  offset?: number;
}

// ── Invoicing: bulk issue / correction / resend / email / mark-paid / bank accounts ──

/** POST /invoices/bulk-issue request body (#1355). */
export interface BulkIssueInvoicesInput {
  connectionId: string;
  orderIds: string[];
}

export type BulkIssueOutcome = 'issued' | 'skipped' | 'failed';

export interface BulkIssueInvoiceResult {
  orderId: string;
  outcome: BulkIssueOutcome;
  invoiceId?: string;
  reason?: string;
}

export interface BulkIssueInvoicesResult {
  issued: number;
  skipped: number;
  failed: number;
  results: BulkIssueInvoiceResult[];
}

/** POST /invoices/:invoiceId/correct request line (#1241). */
export interface IssueCorrectionLineInput {
  originalLineNumber: number;
  newQuantity?: number;
  newUnitPriceGross?: number;
}

/** POST /invoices/:invoiceId/correct request body (#1241). */
export interface IssueCorrectionInput {
  reason?: string;
  lines: IssueCorrectionLineInput[];
  idempotencyKey?: string;
}

/** POST /invoices/:invoiceId/send-email request body (#1353). */
export interface SendInvoiceEmailInput {
  locale?: string;
  sendCopy?: boolean;
}

/** POST /invoices/:invoiceId/send-email response (#1353). */
export interface SendInvoiceEmailResult {
  delivered: boolean;
  recipient: string | null;
}

/** POST /invoices/:invoiceId/mark-paid request body (#1362). Bare `{}` marks paid today. */
export interface MarkInvoicePaidInput {
  paidDate?: string;
}

/** GET /connections/:connectionId/bank-accounts row (#1303 follow-up). */
export interface InvoicingBankAccount {
  id: string;
  accountNumber: string;
  bankName: string;
  isDefault: boolean;
}

/** A raw binary response whose text body is also retained (source XML / documents). */
export interface RawTextResponse extends RawResponse {
  text: string;
}

/**
 * Per-product content state (#2201). Narrowed to what the rich-text specs read:
 * which channels have an editable description for this product.
 */
export interface ProductContentState {
  master: { baseValue: string | null; draftValue: string | null };
  channels: Array<{
    connectionId: string;
    connectionName: string;
    platformType: string;
    baseValue: string | null;
    draftValue: string | null;
  }>;
}

/**
 * A destination's declared description contract (ADR-046).
 *
 * Only the fields the e2e suite asserts on - the API returns more. `declared`
 * false means the destination declared nothing and the response is the
 * conservative shared subset, which the UI must say out loud rather than
 * presenting as authoritative.
 */
export interface DescriptionFormatView {
  shape: 'html' | 'plain-text';
  allowedTags: string[];
  allowedAttributes: Record<string, string[]>;
  contentModel: Record<string, string[]> | null;
  requiresBlockOpener: boolean;
  selfClosingVoids: boolean;
  maxBytes: number | null;
  declared: boolean;
  resolvedVia: 'OfferManager' | 'ProductPublisher' | null;
}

// ── Analytics (#2482) ───────────────────────────────────────────────────
//
// Narrowed to what the mockup-parity spec reads. `tax-a`/`tax-c` (both keyed
// on `order_records.taxRateEra = 'pre-rollout'`, written only by a one-time
// historical backfill migration and never by ingestion) are typed here for
// completeness of `CoverageCategory` but have no seed path in this suite —
// see the follow-up issue referenced from `tests/analytics/mockup-parity.spec.ts`.

export type CoverageCategory = 'currency' | 'tax-a' | 'tax-b' | 'tax-c' | 'product-matching';
export type CoverageResolutionStatus = 'open' | 'in-progress' | 'resolved' | 'failed';

/** GET /analytics/settings response. */
export interface AnalyticsSettingsView {
  displayCurrency: string;
  displayCurrencySource: 'setting' | 'default';
  rateBasis: 'current-rate' | 'order-date';
  includeBackfilledTaxRatesInNetSales: boolean;
  updatedAt: string | null;
  updatedByUserId: string | null;
}

/** PUT /analytics/settings request body. */
export interface UpdateAnalyticsSettingsInput {
  displayCurrency?: string | null;
  rateBasis?: 'current-rate' | 'order-date';
  includeBackfilledTaxRatesInNetSales?: boolean;
}

export interface CoverageCategoryRow {
  category: CoverageCategory;
  status: CoverageResolutionStatus;
  affectedCount: number;
  sampleOrderIds: string[];
  /** Only ever set on the `'currency'` row, and only while `status === 'in-progress'`. */
  activeRunId?: string | null;
}

/** GET /analytics/coverage (and /coverage/by-connection) response. */
export interface AnalyticsCoverageView {
  categories: CoverageCategoryRow[];
}

/** GET /analytics/coverage/currency/status/:runId and POST .../recalculate response. */
export interface AnalyticsRemediationRun {
  id: string;
  category: string;
  status: CoverageResolutionStatus;
  detail: string | null;
  affectedCount: number;
  triggeredByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnalyticsRangeQuery {
  from: string;
  to: string;
  sourceConnectionId?: string;
}

/** GET /analytics/coverage/currency/orders item (detail-currency modal row). */
export interface CurrencyMismatchOrder {
  internalOrderId: string;
  sourceConnectionId: string;
  nativeCurrency: string | null;
  stampedCurrency: string | null;
  stampedAt: string | null;
  lineProducts: { productId: string; variantId: string | null }[];
}

/** GET /analytics/coverage/tax/orders item (detail-tax / detail-novat / detail-postrollout modal row). */
export interface TaxCoverageLineRateObservation {
  productId: string;
  variantId: string | null;
  rateCode: string | null;
  state: 'known' | 'no-rate' | 'not-checked';
  unknownReason?: 'ambiguous' | 'unreadable' | 'not-configured' | null;
}

export interface TaxCoverageOrder {
  internalOrderId: string;
  sourceConnectionId: string;
  placedAt: string | null;
  lineRates: TaxCoverageLineRateObservation[];
}

/** GET /analytics/coverage/matching/orders item (detail-mapping modal row). */
export interface ProductMatchingOrder {
  internalOrderId: string;
  sourceConnectionId: string;
  recordStatus: 'awaiting_mapping' | 'source_deleted';
  mappingFailureReason: string | null;
  createdAt: string;
}

/** POST /analytics/coverage/tax/rerun-backfill response. */
export interface TaxRerunBackfillResult {
  scanned: number;
  updated: number;
}

/** GET /currency-settings response — narrowed to what the suite reads. */
export interface CurrencySettingsView {
  reportingCurrency: string;
  source: 'setting' | 'env' | 'default';
  supportedCurrencies: string[];
}
