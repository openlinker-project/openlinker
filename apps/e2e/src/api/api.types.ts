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
