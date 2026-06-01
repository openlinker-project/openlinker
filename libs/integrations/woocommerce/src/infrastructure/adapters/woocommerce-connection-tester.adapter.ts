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
 * `ConnectionTestResult` with `success: false`.
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
import { WooCommerceHttpClient } from '../http/woocommerce-http-client';
import type { WooCommerceConnectionConfig } from '../../domain/types/woocommerce-config.types';
import type { WooCommerceCredentials } from '../../domain/types/woocommerce-credentials.types';

export class WooCommerceConnectionTesterAdapter implements ConnectionTesterPort {
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
        { maxRetries: 0, initialDelayMs: 0, backoffMultiplier: 1, maxDelayMs: 0 },
      );

      await client.get('/wp-json/wc/v3/products?per_page=1');

      return {
        success: true,
        message: 'OK',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      // AbortController fires after REQUEST_TIMEOUT_MS — surface a clear timeout message
      // rather than the raw DOMException message "The operation was aborted."
      if ((error as { name?: string }).name === 'AbortError') {
        return {
          success: false,
          message: 'WooCommerce connection test timed out — the site did not respond in time',
          latencyMs: Date.now() - startedAt,
        };
      }
      const err = error as { statusCode?: number; message?: string };
      const status = typeof err.statusCode === 'number' ? err.statusCode : undefined;
      return {
        success: false,
        status,
        message: buildFailureMessage(status, err.message),
        latencyMs: Date.now() - startedAt,
      };
    }
  }
}

function buildFailureMessage(status: number | undefined, errorMessage?: string): string {
  if (status === 401 || status === 403) {
    return 'WooCommerce authentication failed — check consumer key and secret';
  }
  if (status === 404) {
    return 'WooCommerce REST API not found — verify the site URL and that WooCommerce is installed';
  }
  if (status !== undefined && status >= 500) {
    return `WooCommerce returned an unexpected error (HTTP ${status})`;
  }
  return errorMessage ?? 'WooCommerce connection test failed';
}
