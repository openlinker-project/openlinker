/**
 * WooCommerce Connection Tester Adapter
 *
 * Implements `ConnectionTesterPort` for WooCommerce connections. Probes
 * `GET /wp-json/wc/v3/products?per_page=1` with the stored credentials.
 *
 * Probe choice rationale:
 * - Requires `products:read` scope — the same key permission needed by the
 *   ProductMaster capability (#874), so a passing test guarantees the key
 *   is scoped correctly for the next capability.
 * - Avoids `system_status` which requires a broader `read_shop` scope and
 *   would produce false negatives for minimal API keys.
 *
 * Never throws — all failures are translated into a structured
 * `ConnectionTestResult` with `success: false`. Unexpected failures (network
 * errors, timeouts) are logged at warn level so they appear in server logs
 * even if the operator doesn't inspect the API response.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters
 * @implements {ConnectionTesterPort}
 */
import type {
  ConnectionTesterPort,
  ConnectionTestResult,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { WooCommerceHttpClient } from '../http/woocommerce-http-client';
import { WooCommerceUnauthorizedException } from '../../domain/exceptions/woocommerce-unauthorized.exception';
import { WooCommerceNetworkException } from '../../domain/exceptions/woocommerce-network.exception';
import { WooCommerceHttpResponseException } from '../http/woocommerce-http-response.exception';
import type { WooCommerceConnectionConfig } from '../../domain/types/woocommerce-config.types';
import type { WooCommerceCredentials } from '../../domain/types/woocommerce-credentials.types';

export class WooCommerceConnectionTesterAdapter implements ConnectionTesterPort {
  private readonly logger = new Logger(WooCommerceConnectionTesterAdapter.name);

  async test(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      const config = (connection.config ?? {}) as Partial<WooCommerceConnectionConfig>;
      if (typeof config.siteUrl !== 'string' || config.siteUrl.length === 0) {
        return {
          success: false,
          message: 'Connection config is missing siteUrl',
          latencyMs: Date.now() - startedAt,
        };
      }

      const credentials = await credentialsResolver.get<WooCommerceCredentials>(
        connection.credentialsRef,
      );

      const client = new WooCommerceHttpClient(
        config.siteUrl,
        credentials.consumerKey,
        credentials.consumerSecret,
        // maxRetries: 0 — connection test is a single-shot probe; retries would
        // mask real latency and make auth failures harder to diagnose.
        { maxRetries: 0, initialDelayMs: 0, backoffMultiplier: 1, maxDelayMs: 0 },
      );

      await client.get('/wp-json/wc/v3/products?per_page=1');

      return {
        success: true,
        message: 'OK',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (error instanceof WooCommerceUnauthorizedException) {
        // WooCommerceUnauthorizedException covers both 401 and 403.
        // Check the error message to surface the correct HTTP status in the result.
        const statusInMsg = error.message.includes('403') ? 403 : 401;
        return {
          success: false,
          status: statusInMsg,
          message: 'WooCommerce authentication failed — check consumer key and secret',
          latencyMs: Date.now() - startedAt,
        };
      }

      if (error instanceof WooCommerceHttpResponseException) {
        const status = error.statusCode;
        if (status === 404) {
          return {
            success: false,
            status,
            message:
              'WooCommerce REST API not found — verify the site URL and that WooCommerce is installed',
            latencyMs: Date.now() - startedAt,
          };
        }
        if (status >= 500) {
          this.logger.warn('WooCommerce connection test failed', {
            connectionId: connection.id,
            status,
            error: error.message,
          });
          return {
            success: false,
            status,
            message: `WooCommerce returned an unexpected error (HTTP ${status})`,
            latencyMs: Date.now() - startedAt,
          };
        }
        this.logger.warn('WooCommerce connection test failed', {
          connectionId: connection.id,
          status,
          error: error.message,
        });
        return {
          success: false,
          status,
          message: `WooCommerce returned HTTP ${status}`,
          latencyMs: Date.now() - startedAt,
        };
      }

      if (error instanceof WooCommerceNetworkException) {
        const isTimeout = error.message.includes('timed out');
        if (isTimeout) {
          this.logger.warn('WooCommerce connection test timed out', {
            connectionId: connection.id,
          });
          return {
            success: false,
            message:
              'WooCommerce connection test timed out — the site did not respond in time',
            latencyMs: Date.now() - startedAt,
          };
        }
        // Raw OS error (e.g. "ECONNREFUSED 10.0.0.5:5432") logged server-side only —
        // never returned to caller to avoid leaking internal network topology.
        this.logger.warn('WooCommerce connection test failed: network error', {
          connectionId: connection.id,
          error: error.originalError?.message ?? error.message,
        });
        return {
          success: false,
          message: 'Could not reach the WooCommerce site — check the URL and network connectivity',
          latencyMs: Date.now() - startedAt,
        };
      }

      const err = error as { message?: string };
      this.logger.warn('WooCommerce connection test failed unexpectedly', {
        connectionId: connection.id,
        error: err.message,
      });
      return {
        success: false,
        message: 'WooCommerce connection test failed — check server logs for details',
        latencyMs: Date.now() - startedAt,
      };
    }
  }
}
