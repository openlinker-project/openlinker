/**
 * PrestaShop Connection Tester Adapter
 *
 * Implements ConnectionTesterPort for PrestaShop connections. Performs a cheap
 * authenticated probe against `GET /api/products?limit=1` to validate that the
 * configured base URL + webservice API key still work.
 *
 * Never throws — all failures are translated into a structured
 * `ConnectionTestResult` with `success: false`.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 * @implements {ConnectionTesterPort}
 */
import {
  ConnectionTesterPort,
  ConnectionTestResult,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import { Connection } from '@openlinker/core/identifier-mapping';
import { PrestashopWebserviceClient } from '../http/prestashop-webservice.client';
import { PrestashopCredentials } from '../../domain/types/prestashop-credentials.types';
import { PrestashopConnectionConfig } from '../../domain/types/prestashop-config.types';

export class PrestashopConnectionTesterAdapter implements ConnectionTesterPort {
  async test(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      const baseUrl = (connection.config as Record<string, unknown>).baseUrl;
      if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
        return {
          success: false,
          message: 'Connection config is missing baseUrl',
          latencyMs: Date.now() - startedAt,
        };
      }

      const credentials = await credentialsResolver.get<PrestashopCredentials>(
        connection.credentialsRef,
      );

      const config: PrestashopConnectionConfig = {
        baseUrl,
        timeoutMs: 5000,
        pageSize: 1,
        langId: 1,
        responseFormat: 'auto',
      };

      const client = new PrestashopWebserviceClient(
        baseUrl,
        credentials,
        config,
        { maxRetries: 0, initialDelayMs: 0, maxDelayMs: 0, backoffMultiplier: 1 },
      );

      await client.listResources('products', undefined, 1);

      return {
        success: true,
        status: 200,
        message: 'OK',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const err = error as { name?: string; statusCode?: number; message?: string };
      let status: number | undefined;
      if (typeof err.statusCode === 'number') {
        status = err.statusCode;
      } else if (err.name === 'PrestashopAuthenticationException') {
        status = 401;
      } else if (err.name === 'PrestashopResourceNotFoundException') {
        status = 404;
      }
      return {
        success: false,
        status,
        message: err.message ?? 'PrestaShop probe failed',
        latencyMs: Date.now() - startedAt,
      };
    }
  }
}
