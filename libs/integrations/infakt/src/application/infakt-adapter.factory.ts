/**
 * Infakt Adapter Factory
 *
 * Resolves credentials from the host secrets store and constructs an
 * `InfaktInvoicingAdapter` bound to a specific connection.
 *
 * @module libs/integrations/infakt/src/application
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import { InfaktHttpClient, INFAKT_DEFAULT_BASE_URL } from '../infrastructure/http/infakt-http-client';
import { InfaktInvoicingAdapter } from '../infrastructure/adapters/infakt-invoicing.adapter';
import { InfaktConfigException } from '../domain/exceptions/infakt-config.exception';
import type { IInfaktAdapterFactory } from './interfaces/infakt-adapter.factory.interface';
import type { InfaktCredentials, InfaktConnectionConfig } from '../domain/types/infakt-connection.types';

export class InfaktAdapterFactory implements IInfaktAdapterFactory {
  async createInvoicingAdapter(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    logger: LoggerPort,
  ): Promise<InfaktInvoicingAdapter> {
    let apiKey: string;
    if (connection.credentialsRef) {
      const raw = await credentialsResolver.get(connection.credentialsRef);
      const creds = raw as InfaktCredentials;
      apiKey = creds.apiKey;
    } else {
      throw new InfaktConfigException(
        `Infakt connection ${connection.id} has no credentialsRef`,
        connection.id,
      );
    }

    const config = (connection.config ?? {}) as InfaktConnectionConfig;
    const httpClient = new InfaktHttpClient(
      { apiKey, baseUrl: config.baseUrl ?? INFAKT_DEFAULT_BASE_URL },
      logger,
    );

    return new InfaktInvoicingAdapter(connection.id, httpClient, logger, config);
  }
}
