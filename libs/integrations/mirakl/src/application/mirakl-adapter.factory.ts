/**
 * Mirakl Adapter Factory
 *
 * Builds one connection's HTTP client and import tracker from the operator
 * profile and the connection's credentials and config. Every Mirakl adapter
 * and the connection tester go through here, so key, base URL and shop id are
 * resolved in one place.
 *
 * The config validator already refuses a bad shop id on save; this re-checks,
 * because a row written around the validator must fail before a request, not
 * act on the key's default shop.
 *
 * Plain class, not `@Injectable`: what it builds closes over one connection's
 * key.
 *
 * @module libs/integrations/mirakl/src/application
 * @implements {IMiraklAdapterFactory}
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { FetchLike } from '@openlinker/shared/http';
import { MiraklConfigException } from '../domain/exceptions/mirakl-config.exception';
import {
  readMiraklShopId,
  resolveMiraklBaseUrl,
  resolveMiraklOrderAcceptance,
} from '../domain/policies/mirakl-connection-config.policy';
import type {
  MiraklConnectionConfig,
  MiraklCredentials,
} from '../domain/types/mirakl-connection.types';
import type { MiraklOperatorProfile } from '../domain/types/mirakl-operator-profile.types';
import { MiraklHttpClient } from '../infrastructure/http/mirakl-http-client';
import type { RetryConfig } from '../infrastructure/http/mirakl-http-client.types';
import { MiraklOrderSourceAdapter } from '../infrastructure/adapters/mirakl-order-source.adapter';
import { MiraklImportTracker } from '../infrastructure/imports/mirakl-import-tracker';
import type {
  IMiraklAdapterFactory,
  MiraklAdapters,
  MiraklConnectionClients,
} from './interfaces/mirakl-adapter.factory.interface';

export class MiraklAdapterFactory implements IMiraklAdapterFactory {
  constructor(private readonly profile: MiraklOperatorProfile) {}

  async createClients(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    fetchImpl: FetchLike,
    retryConfig?: Partial<RetryConfig>,
  ): Promise<MiraklConnectionClients> {
    const credentials = await this.resolveCredentials(connection, credentialsResolver);
    const config = (connection.config ?? {}) as MiraklConnectionConfig;
    const shopId = this.resolveShopId(connection, config);
    const httpClient = new MiraklHttpClient(
      connection.id,
      resolveMiraklBaseUrl(this.profile, config.environment),
      credentials.apiKey.trim(),
      fetchImpl,
      shopId,
      retryConfig,
    );
    return { httpClient, importTracker: new MiraklImportTracker(httpClient, connection.id) };
  }

  async createAdapters(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    fetchImpl: FetchLike,
  ): Promise<MiraklAdapters> {
    const { httpClient } = await this.createClients(connection, credentialsResolver, fetchImpl);
    const config = (connection.config ?? {}) as MiraklConnectionConfig;
    return {
      orderSource: new MiraklOrderSourceAdapter(
        connection.id,
        httpClient,
        resolveMiraklOrderAcceptance(config.orderAcceptance),
      ),
    };
  }

  private async resolveCredentials(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<MiraklCredentials> {
    if (!connection.credentialsRef) {
      throw new MiraklConfigException(
        `${this.profile.brand} connection ${connection.id} is missing credentialsRef`,
        connection.id,
      );
    }
    const credentials = await credentialsResolver.get<MiraklCredentials>(connection.credentialsRef);
    if (typeof credentials?.apiKey !== 'string' || credentials.apiKey.trim().length === 0) {
      throw new MiraklConfigException(
        `${this.profile.brand} connection ${connection.id} credentials are missing a non-empty apiKey`,
        connection.id,
      );
    }
    return credentials;
  }

  private resolveShopId(connection: Connection, config: MiraklConnectionConfig): string | undefined {
    const reading = readMiraklShopId(config.shopId);
    switch (reading.kind) {
      case 'absent':
        return undefined;
      case 'valid':
        return reading.shopId;
      case 'invalid':
        throw new MiraklConfigException(
          `${this.profile.brand} connection ${connection.id} has an invalid shopId (must be a positive integer)`,
          connection.id,
        );
    }
  }
}
