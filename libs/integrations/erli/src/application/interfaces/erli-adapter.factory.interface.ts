/**
 * Erli Adapter Factory Interface
 *
 * Contract for the single per-connection construction seam of the Erli plugin:
 * resolve a connection's static API key + base URL and build a configured
 * `ErliHttpClient`. Mirrors the `IAllegroAdapterFactory` /
 * `IPrestashopAdapterFactory` precedent so consumers (the #982 connection
 * tester, the future #984 offers / #993 orders adapters) depend on the
 * abstraction rather than the concrete factory class.
 *
 * @module libs/integrations/erli/src/application/interfaces
 */
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { OfferCreator, OfferFieldUpdater, OfferManagerPort } from '@openlinker/core/listings';
import type { OrderSourcePort } from '@openlinker/core/orders';
// eslint-disable-next-line no-restricted-imports -- local relative import is intentional here; barrel path would create a runtime cycle
import type { IErliHttpClient } from '../../infrastructure/http/erli-http-client.interface';
// eslint-disable-next-line no-restricted-imports -- local relative import is intentional here; barrel path would create a runtime cycle
import type { RetryConfig } from '../../infrastructure/http/erli-http-client.types';

/** Per-connection Erli capability adapters resolved by `createAdapters` (#984/#993). */
export interface ErliAdapters {
  offerManager: OfferManagerPort & OfferCreator & OfferFieldUpdater;
  orderSource: OrderSourcePort;
}

export interface IErliAdapterFactory {
  /**
   * Build the per-connection capability adapters. `identifierMapping` is unused
   * by the seller-keyed-id offer adapter today but kept so later issues extend
   * behaviour without churning this signature or the plugin's dispatch call site
   * (mirrors the Allegro precedent).
   */
  createAdapters(
    connection: Connection,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<ErliAdapters>;

  /**
   * Build a per-connection Erli HTTP client. Pass `retryConfig` to override the
   * default retry budget — the connection tester passes a no-retry config so a
   * probe fails fast.
   */
  createHttpClient(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    retryConfig?: Partial<RetryConfig>,
  ): Promise<IErliHttpClient>;
}
