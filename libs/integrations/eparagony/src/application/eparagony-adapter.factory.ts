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
import { EparagonyInvoicingAdapter } from '../infrastructure/adapters/eparagony-invoicing.adapter';
import { EparagonyHttpClient } from '../infrastructure/http/eparagony-http-client';
import type {
  EparagonyAdapters,
  IEparagonyAdapterFactory,
} from './interfaces/eparagony-adapter.factory.interface';

export class EparagonyAdapterFactory implements IEparagonyAdapterFactory {
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

    return {
      fiscalization: new EparagonyFiscalizationAdapter(connection.id, httpClient, logger, config),
      invoicing: new EparagonyInvoicingAdapter(connection.id, httpClient, logger, config),
    };
  }
}
