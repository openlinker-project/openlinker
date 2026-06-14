/**
 * Erli Adapter Factory
 *
 * Single per-connection construction seam for the Erli plugin: resolves the
 * connection's static API key + base URL and builds a configured
 * `ErliHttpClient`. The #982 connection tester and the future #984 (offers) /
 * #993 (orders) capability adapters all route through here so credential and
 * base-URL resolution lives in one place.
 *
 * Not `@Injectable` — a plain class; the client it builds closes over one
 * connection's API key (ADR-025 static-key model, never a DI singleton).
 *
 * @module libs/integrations/erli/src/application
 */
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { ErliConfigException } from '../domain/exceptions/erli-config.exception';
import {
  ERLI_DEFAULT_BASE_URL,
  type ErliConnectionConfig,
  type ErliCredentials,
} from '../domain/types/erli-connection.types';
import { ErliHttpClient } from '../infrastructure/http/erli-http-client';
import type { IErliHttpClient } from '../infrastructure/http/erli-http-client.interface';
import type { RetryConfig } from '../infrastructure/http/erli-http-client.types';
import type { IErliAdapterFactory } from './interfaces/erli-adapter.factory.interface';

export class ErliAdapterFactory implements IErliAdapterFactory {
  /**
   * Build a per-connection Erli HTTP client. Pass `retryConfig` to override the
   * default retry budget — the connection tester passes a no-retry config so a
   * probe fails fast.
   */
  async createHttpClient(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    retryConfig?: Partial<RetryConfig>,
  ): Promise<IErliHttpClient> {
    const { apiKey } = await this.resolveCredentials(connection, credentialsResolver);
    const baseUrl = this.resolveBaseUrl(connection);
    return new ErliHttpClient(connection.id, baseUrl, apiKey, retryConfig);
  }

  private async resolveCredentials(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<ErliCredentials> {
    if (!connection.credentialsRef) {
      throw new ErliConfigException(
        `Erli connection ${connection.id} is missing credentialsRef`,
        connection.id,
      );
    }
    const credentials = await credentialsResolver.get<ErliCredentials>(connection.credentialsRef);
    if (typeof credentials?.apiKey !== 'string' || credentials.apiKey.trim().length === 0) {
      throw new ErliConfigException(
        `Erli connection ${connection.id} credentials are missing a non-empty apiKey`,
        connection.id,
      );
    }
    return credentials;
  }

  private resolveBaseUrl(connection: Connection): string {
    const config = (connection.config ?? {}) as ErliConnectionConfig;
    const override = config.baseUrl?.trim();
    return override && override.length > 0 ? override : ERLI_DEFAULT_BASE_URL;
  }
}
