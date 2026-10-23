/**
 * eparagony.pl Adapter Factory
 *
 * Resolves a connection's credentials from the host secrets store, resolves its
 * two hosts, and constructs the connection's capability adapters - the receipt
 * lane (`EparagonyFiscalizationAdapter`) and the invoice lane
 * (`EparagonyInvoicingAdapter`) - bound to that one connection.
 *
 * ONE `EparagonyHttpClient` SERVES BOTH, and that is the reason this is a
 * single method returning a bag rather than one method per capability (#3192).
 * The client owns the OAuth token cache and the single-in-flight-token collapse;
 * the vendor rate-limits `/auth/token` per IP. Two clients per connection would
 * mean two cold token caches racing the same endpoint, for no gain - the scope
 * set (`document_create printer_get ecommerce`) already covers both lanes, so
 * one token authorises everything either adapter does.
 *
 * Deliberately fails LOUD and EARLY on a connection that cannot work at all -
 * missing credentials, missing `posId`. A registration that reached the adapter
 * and then failed on a missing `posId` would cost a persisted in-doubt record
 * and an operator investigation; failing at construction costs a clear error.
 *
 * `merchantTIN` is NOT one of those checks, and that asymmetry is deliberate.
 * It is mandatory on an invoice and meaningless on a receipt, and every
 * connection that exists today is receipts-only, so refusing construction
 * without it would stop those connections registering a single sale. The
 * invoice mapper refuses pre-call instead, naming the remedy, which keeps the
 * failure on the lane that needs the value.
 *
 * ## The HTTP client is memoised per connection (#3382)
 *
 * `getCapabilityAdapter` constructs a fresh adapter on EVERY call - the same
 * property #2593 records for the catalogue sweep - so before this change
 * `createAdapters` also built a fresh `EparagonyHttpClient` on every one of
 * those calls, and with it a fresh, empty OAuth token cache. That cache is
 * built specifically because the vendor's `/auth/token` endpoint is
 * rate-limited per IP and "explicitly tells integrators not to fetch a token
 * per request" (see the client's own header) - and it was being discarded
 * before it could ever be read a second time.
 *
 * Measured on the #2840 perf stand and counted at the stub, not inferred:
 * 22 `/auth/token` requests for 22 documents, one apiece, against a token the
 * vendor issues with `expires_in: 3600`. The #2592 hoist already moved the
 * FACTORY instance to live for the plugin descriptor's lifetime
 * (`eparagony-plugin.ts`), but its own docblock said explicitly that the
 * token cache did NOT outlive a capability resolution, because the client
 * itself was still built fresh inside `createAdapters`. This closes that gap:
 * the client is now cached per connection, keyed on everything that must
 * invalidate it.
 *
 * **Credentials are still re-resolved on every call, deliberately.** That is
 * what keeps a rotation visible: `ConnectionService.updateCredentials` writes
 * only to the credentials store and does NOT touch the connection row, so
 * `connection.updatedAt` does not move on a rotation and a key built from it
 * alone would serve a client holding the old secret until the process
 * restarted. The cache key therefore carries a digest of the resolved
 * credentials as well as `updatedAt` (which covers config edits, including
 * `config.rateLimit`, since the memoised client also holds the
 * connection-bound transport). One entry per connection: a rotation REPLACES
 * rather than adds.
 *
 * @module libs/integrations/eparagony/src/application
 * @implements {IEparagonyAdapterFactory}
 */
import { createHash } from 'node:crypto';

import type { LoggerPort } from '@openlinker/shared/logging';
import type { FetchLike } from '@openlinker/shared/http';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';

import { EparagonyConfigException } from '../domain/exceptions/eparagony-config.exception';
import { readEparagonyConnectionConfig } from '../domain/policies/connection-config.policy';
import { resolveEparagonyHosts } from '../domain/policies/eparagony-hosts.policy';
import type { EparagonyCredentials } from '../domain/types/eparagony-credentials.types';
import { EparagonyFiscalizationAdapter } from '../infrastructure/adapters/eparagony-fiscalization.adapter';
import { EparagonyInvoicingAdapter } from '../infrastructure/adapters/eparagony-invoicing.adapter';
import { EparagonyHttpClient } from '../infrastructure/http/eparagony-http-client';
import type {
  EparagonyAdapters,
  IEparagonyAdapterFactory,
} from './interfaces/eparagony-adapter.factory.interface';

export class EparagonyAdapterFactory implements IEparagonyAdapterFactory {
  /**
   * One live client per connection, keyed by everything that shapes it. Not
   * an LRU and not TTL'd: the bound is the number of eparagony connections an
   * install has, which is small, and an entry is replaced rather than added
   * when its key changes.
   */
  private readonly clients = new Map<string, { key: string; client: EparagonyHttpClient }>();

  async createAdapters(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    logger: LoggerPort,
    fetchImpl: FetchLike,
  ): Promise<EparagonyAdapters> {
    if (!connection.credentialsRef) {
      throw new EparagonyConfigException(
        `eparagony.pl connection ${connection.id} has no credentialsRef`,
        'The e-receipt connection has no stored credentials.',
        connection.id,
      );
    }

    const credentials = await credentialsResolver.get<EparagonyCredentials>(
      connection.credentialsRef,
    );
    if (!credentials?.clientId || !credentials?.clientSecret) {
      throw new EparagonyConfigException(
        `eparagony.pl connection ${connection.id} is missing clientId or clientSecret`,
        'The e-receipt connection is missing its client credentials.',
        connection.id,
      );
    }

    const config = readEparagonyConnectionConfig(connection.config);
    if (typeof config.posId !== 'string' || config.posId.trim().length === 0) {
      throw new EparagonyConfigException(
        `eparagony.pl connection ${connection.id} has no posId`,
        'The e-receipt connection has no point-of-sale identifier configured.',
        connection.id,
      );
    }

    const hosts = resolveEparagonyHosts(config, connection.id);
    const key = this.clientCacheKey(connection, hosts.apiBaseUrl, hosts.authBaseUrl, credentials);

    const cached = this.clients.get(connection.id);
    let httpClient: EparagonyHttpClient;
    if (cached !== undefined && cached.key === key) {
      httpClient = cached.client;
    } else {
      httpClient = new EparagonyHttpClient(
        {
          connectionId: connection.id,
          apiBaseUrl: hosts.apiBaseUrl,
          authBaseUrl: hosts.authBaseUrl,
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          ...(credentials.integrationId === undefined
            ? {}
            : { integrationId: credentials.integrationId }),
        },
        logger,
        fetchImpl,
      );
      this.clients.set(connection.id, { key, client: httpClient });
    }

    return {
      fiscalization: new EparagonyFiscalizationAdapter(connection.id, httpClient, logger, config),
      invoicing: new EparagonyInvoicingAdapter(connection.id, httpClient, logger, config),
    };
  }

  /**
   * Everything that must mint a NEW client, in one string.
   *
   * `updatedAt` covers every edit that goes through the connection row - the
   * hosts, and `config.rateLimit`, which shapes the connection-bound
   * transport the memoised client closes over. The credential digest covers
   * the one edit that does NOT go through that row (a rotation writes only
   * the credentials store), and is a SHA-256 rather than the values
   * themselves so a secret is never a map key, never rendered by a
   * debugger's map view, and never loggable by accident.
   */
  private clientCacheKey(
    connection: Connection,
    apiBaseUrl: string,
    authBaseUrl: string,
    credentials: EparagonyCredentials,
  ): string {
    const secretDigest = createHash('sha256')
      .update(
        JSON.stringify([
          credentials.clientId,
          credentials.clientSecret,
          credentials.integrationId ?? null,
        ]),
      )
      .digest('hex');
    const updatedAt =
      connection.updatedAt instanceof Date
        ? connection.updatedAt.toISOString()
        : String(connection.updatedAt ?? '');
    return [connection.id, updatedAt, apiBaseUrl, authBaseUrl, secretDigest].join('|');
  }
}
