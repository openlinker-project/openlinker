/**
 * Mirakl Adapter Factory Interface
 *
 * The per-connection construction seam: resolves a connection's key, base URL
 * and shop id once and builds the HTTP client and import tracker every Mirakl
 * adapter uses, and the capability adapters built on them. Each capability
 * joins `MiraklAdapters` with the issue that delivers it (#4275 orders, #4277
 * offers).
 *
 * @module libs/integrations/mirakl/src/application/interfaces
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { OrderSourcePort } from '@openlinker/core/orders';
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
    retryConfig?: Partial<RetryConfig>,
  ): Promise<MiraklConnectionClients>;

  /** Build the connection's capability adapters on top of its clients. */
  createAdapters(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    fetchImpl: FetchLike,
  ): Promise<MiraklAdapters>;
}
