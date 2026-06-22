/**
 * Subiekt Adapter Factory (#753)
 *
 * Builds per-connection Subiekt adapters from a `Connection`. Validates and
 * parses `connection.config` into `SubiektConnectionConfig`, resolves the
 * OPTIONAL bridge token ONLY when `connection.credentialsRef` is truthy
 * (`CredentialsResolverPort.get` must never be called with `''`), constructs the
 * `SubiektBridgeHttpClient` (whose construction may throw `SubiektConfigException`
 * for a bad / IMDS URL — propagated to the caller), and wraps it in a
 * `SubiektInvoicingAdapter`. Pure construction, no Nest decorators.
 *
 * @module libs/integrations/subiekt/src/application
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { LoggerPort } from '@openlinker/shared/logging';
import type { SubiektConnectionConfig } from '../domain/types/subiekt-connection-config.types';
import type { SubiektBridgeCredentials } from '../domain/types/subiekt-credentials.types';
import { SubiektConfigException } from '../domain/exceptions/subiekt-config.exception';
import { SubiektInvoicingAdapter } from '../infrastructure/adapters/subiekt-invoicing.adapter';
import { SubiektBridgeHttpClient } from '../infrastructure/http/subiekt-bridge-http.client';

/** The capability adapters this factory builds for a connection. */
export interface SubiektAdapters {
  invoicing: SubiektInvoicingAdapter;
}

export class SubiektAdapterFactory {
  async createAdapters(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    logger: LoggerPort,
  ): Promise<SubiektAdapters> {
    const config = this.validateAndParseConfig(
      (connection.config ?? {}) as Record<string, unknown>,
    );

    // The bridge token is OPTIONAL — resolve only when credentialsRef is
    // truthy. Never call credentialsResolver.get('').
    let token: string | undefined;
    if (connection.credentialsRef) {
      const credentials = await credentialsResolver.get<SubiektBridgeCredentials>(
        connection.credentialsRef,
      );
      token = credentials.bridgeToken;
    }

    // Construction may throw SubiektConfigException for a bad / IMDS URL —
    // propagated to the caller.
    const client = new SubiektBridgeHttpClient(config.bridgeBaseUrl, {
      token,
      timeoutMs: config.timeoutMs,
    });

    return {
      invoicing: new SubiektInvoicingAdapter(client, connection.id, logger),
    };
  }

  /**
   * Validate and parse the raw `connection.config` blob.
   * @throws SubiektConfigException on a missing / malformed `bridgeBaseUrl` or
   *   out-of-range `timeoutMs`.
   */
  private validateAndParseConfig(config: Record<string, unknown>): SubiektConnectionConfig {
    const bridgeBaseUrl = config.bridgeBaseUrl;
    if (typeof bridgeBaseUrl !== 'string' || bridgeBaseUrl.length === 0) {
      throw new SubiektConfigException(
        'bridgeBaseUrl is required and must be a non-empty string',
        'bridgeBaseUrl',
        bridgeBaseUrl,
      );
    }

    let timeoutMs: number | undefined;
    if (config.timeoutMs !== undefined) {
      const raw = config.timeoutMs;
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1000 || raw > 120000) {
        throw new SubiektConfigException(
          'timeoutMs must be an integer between 1000 and 120000',
          'timeoutMs',
          raw,
        );
      }
      timeoutMs = raw;
    }

    return timeoutMs !== undefined ? { bridgeBaseUrl, timeoutMs } : { bridgeBaseUrl };
  }
}
