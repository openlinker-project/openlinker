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
 * @module libs/integrations/eparagony/src/application
 * @implements {IEparagonyAdapterFactory}
 */
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
    const httpClient = new EparagonyHttpClient(
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

    return new EparagonyFiscalizationAdapter(connection.id, httpClient, logger, config);
  }
}
