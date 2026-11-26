/**
 * Mirakl Adapter Factory Interface
 *
 * The per-connection construction seam: resolves a connection's key, base URL
 * and shop id once and builds the HTTP client and import tracker every Mirakl
 * adapter uses, and the capability adapters built on them. Each capability
 * joins `MiraklAdapters` with the issue that delivers it (#4275 orders, #4277
 * offers, #4284 catalogue and stock master).
 *
 * @module libs/integrations/mirakl/src/application/interfaces
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { InventoryMasterPort } from '@openlinker/core/inventory';
import type { OfferManagerPort } from '@openlinker/core/listings';
import type { OrderSourcePort } from '@openlinker/core/orders';
import type { ProductMasterPort } from '@openlinker/core/products';
import type { CachePort } from '@openlinker/shared/cache';
import type { FetchLike } from '@openlinker/shared/http';
import type { IMiraklHttpClient } from '../../infrastructure/http/mirakl-http-client.interface';
import type { RetryConfig } from '../../infrastructure/http/mirakl-http-client.types';
import type { IMiraklImportTracker } from '../../infrastructure/imports/mirakl-import-tracker.interface';

/** What one connection's adapters share. */
export interface MiraklConnectionClients {
  readonly httpClient: IMiraklHttpClient;
  readonly importTracker: IMiraklImportTracker;
}

/** The capability adapters for one connection. */
export interface MiraklAdapters {
  readonly orderSource: OrderSourcePort;
  readonly offerManager: OfferManagerPort;
  readonly productMaster: ProductMasterPort;
  readonly inventoryMaster: InventoryMasterPort;
}

/** Host services the catalogue and stock masters need (#4284). */
export interface MiraklMasterServices {
  readonly identifierMapping: IdentifierMappingPort;
  /** Stock idempotency and pending targets; optional like on every host. */
  readonly cache?: CachePort;
}

export interface IMiraklAdapterFactory {
  /**
   * Build the connection's HTTP client and import tracker. Pass `retryConfig`
   * to override the retry budget (the connection tester passes none, so a
   * probe fails fast).
   */
  createClients(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    fetchImpl: FetchLike,
    retryConfig?: Partial<RetryConfig>
  ): Promise<MiraklConnectionClients>;

  /** Build the connection's capability adapters on top of its clients. */
  createAdapters(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    fetchImpl: FetchLike,
    master: MiraklMasterServices
  ): Promise<MiraklAdapters>;
}
