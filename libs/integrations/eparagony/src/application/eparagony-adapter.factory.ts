/**
 * eparagony.pl Adapter Factory
 *
 * Resolves a connection's credentials from the host secrets store, resolves its
 * two hosts, and constructs an `EparagonyFiscalizationAdapter` bound to that one
 * connection.
 *
 * Deliberately fails LOUD and EARLY on a connection that cannot work at all -
 * missing credentials, missing `posId`. A registration that reached the adapter
 * and then failed on a missing `posId` would cost a persisted in-doubt record
 * and an operator investigation; failing at construction costs a clear error.
 *
 * ## The HTTP client is reused across adapters; the adapter is not (#2840)
 *
 * `getCapabilityAdapter` constructs a fresh adapter on EVERY call - the same
 * property #2593 records for the catalogue sweep - so before this change every
 * fiscal registration also got a fresh `EparagonyHttpClient` with an empty
 * token cache. That client's own header says the vendor "explicitly tells
 * integrators not to fetch a token per request", and the cache it builds to
 * honour that was being discarded before it could ever be read a second time.
 *
 * Measured on the #2840 stand: **22 token requests for 22 documents**, one
 * apiece, counted by the stub rather than inferred. At that stub's declared
 * 2 000 ms that is 2 000 ms of a 9 071 ms registration - 22% - spent
 * re-authenticating with a token the vendor issues valid for an hour. Against a
 * real provider it also spends their per-IP `/auth/token` budget, which is the
 * limit the client's header warns about.
 *
 * So the CLIENT is memoised per connection and the adapter still is not: the
 * adapter is cheap and stateless, the client holds the token.
 *
 * **Credentials are re-resolved on every call, deliberately.** That is what
 * keeps a rotation visible: `ConnectionService.updateCredentials` writes only to
 * the credentials store and does NOT touch the connection row, so
 * `connection.updatedAt` does not move on a rotation and a key built from it
 * alone would serve a client holding the old secret until the process
 * restarted. The cache key therefore carries a digest of the resolved
 * credentials as well as `updatedAt` (which covers config edits, including
 * `config.rateLimit`, since the memoised client also holds the connection-bound
 * transport). One entry per connection: a rotation REPLACES rather than adds.
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
import { EparagonyHttpClient } from '../infrastructure/http/eparagony-http-client';
import type { IEparagonyAdapterFactory } from './interfaces/eparagony-adapter.factory.interface';

export class EparagonyAdapterFactory implements IEparagonyAdapterFactory {
  /**
   * One live client per connection, keyed by everything that shapes it. Not an
   * LRU and not TTL'd: the bound is the number of eparagony connections an
   * install has, which is small, and an entry is replaced rather than added
   * when its key changes.
   */
  private readonly clients = new Map<string, { key: string; client: EparagonyHttpClient }>();

  async createFiscalizationAdapter(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    logger: LoggerPort,
    fetchImpl: FetchLike,
  ): Promise<EparagonyFiscalizationAdapter> {
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

    return new EparagonyFiscalizationAdapter(connection.id, httpClient, logger, config);
  }

  /**
   * Everything that must mint a NEW client, in one string.
   *
   * `updatedAt` covers every edit that goes through the connection row - the
   * hosts, and `config.rateLimit`, which shapes the connection-bound transport
   * the memoised client closes over. The credential digest covers the one edit
   * that does NOT go through that row (a rotation writes only the credentials
   * store), and is a SHA-256 rather than the values themselves so a secret is
   * never a map key, never rendered by a debugger's map view, and never
   * loggable by accident.
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
