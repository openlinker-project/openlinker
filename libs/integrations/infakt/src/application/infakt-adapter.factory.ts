/**
 * Infakt Adapter Factory
 *
 * Resolves credentials from the host secrets store and constructs an
 * `InfaktInvoicingAdapter` bound to a specific connection.
 *
 * Logs the resolved environment + host per connection (#2179 review round 3,
 * Suggestion #2). Every document this adapter issues goes to whatever
 * `resolveInfaktBaseUrl` returns, and sandbox vs production is the difference
 * between a test document and a legally issued invoice - so the choice is
 * recorded rather than left implicit. The API key is never logged.
 *
 * @module libs/integrations/infakt/src/application
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import type { FetchLike } from '@openlinker/shared/http';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import { InfaktHttpClient } from '../infrastructure/http/infakt-http-client';
import { InfaktInvoicingAdapter } from '../infrastructure/adapters/infakt-invoicing.adapter';
import { InfaktConfigException } from '../domain/exceptions/infakt-config.exception';
import {
  describeInfaktTarget,
  resolveInfaktBaseUrl,
} from '../domain/policies/infakt-base-url.policy';
import type { IInfaktAdapterFactory } from './interfaces/infakt-adapter.factory.interface';
import type { InfaktCredentials, InfaktConnectionConfig } from '../domain/types/infakt-connection.types';

export class InfaktAdapterFactory implements IInfaktAdapterFactory {
  async createInvoicingAdapter(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    logger: LoggerPort,
    fetchImpl: FetchLike,
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
    const baseUrl = resolveInfaktBaseUrl(config, connection.id);
    logger.log(
      `Infakt connection ${connection.id} resolved target: ${describeInfaktTarget(config, baseUrl)}`,
    );
    const httpClient = new InfaktHttpClient({ apiKey, baseUrl }, logger, fetchImpl);

    return new InfaktInvoicingAdapter(connection.id, httpClient, logger, config);
  }
}
