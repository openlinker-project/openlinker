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
  recordStatus: 'ready' | 'awaiting_mapping';
  createdAt: string;
  updatedAt: string;
}

/** POST /invoices — server assembles lines/buyer from the order. */
export interface IssueInvoiceInput {
  connectionId: string;
  orderId: string;
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
  items: CategoryParameter[];
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

export interface GenerateLabelInput {
  sourceConnectionId: string;
  sourceDeliveryMethodId?: string;
  orderId: string;
  deliveryIntent?: 'pickup_point' | 'address';
  paczkomatId?: string;
  recipient?: Record<string, unknown>;
  parcel?: Record<string, unknown>;
  cod?: { amount: string; currency: string };
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
  createdAt: string;
  updatedAt: string;
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

export interface ConnectionFilters {
  platformType?: string;
  status?: string;
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
}

export interface ListInvoicesQuery {
  status?: string;
  connectionId?: string;
  regulatoryStatus?: string;
  limit?: number;
  offset?: number;
}
