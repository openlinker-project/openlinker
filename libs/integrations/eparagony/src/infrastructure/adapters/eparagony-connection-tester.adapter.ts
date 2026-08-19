/**
 * eparagony.pl Connection Tester
 *
 * Probes a live connection so OL Admin can show it Active (or a clear failure)
 * right after the operator saves their client credentials.
 *
 * The probe is the OAuth token request itself, not an API read. That is the
 * right choice here rather than a convenience: the token endpoint is the only
 * call that exercises the client id, the client secret AND the granted scope
 * set in one round-trip, and a scope OL is not granted fails at token issuance
 * rather than at the endpoint it would have unlocked.
 *
 * When the connection names its fiscal device, the tester ALSO reports the
 * device's liveness - but only ever as extra text on a successful result, never
 * as a failure. Two reasons, and the second is the important one:
 *
 *   - The device is the seller's, sitting behind the vendor's own print service.
 *     A quiet printer is an operations problem for the seller, not a broken
 *     OpenLinker connection, and reporting it as a connection failure would send
 *     the operator to re-check credentials that are fine.
 *   - The vendor's sandbox has no device attached at all and answers `INACTIVE`
 *     for every device number. Failing on `INACTIVE` would make every sandbox
 *     connection permanently untestable.
 *
 * @module libs/integrations/eparagony/src/infrastructure/adapters
 * @see {@link ConnectionTesterPort}
 */
import type {
  ConnectionTesterPort,
  ConnectionTestResult,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';

import { EparagonyApiError } from '../../domain/exceptions/eparagony-api.error';
import { EparagonyConfigException } from '../../domain/exceptions/eparagony-config.exception';
import { EparagonyNetworkError } from '../../domain/exceptions/eparagony-network.error';
import { readEparagonyConnectionConfig } from '../../domain/policies/connection-config.policy';
import { resolveEparagonyHosts } from '../../domain/policies/eparagony-hosts.policy';
import type { EparagonyPrinterStatusResponse } from '../../domain/types/eparagony-api.types';
import type { EparagonyConnectionConfig } from '../../domain/types/eparagony-config.types';
import type { EparagonyCredentials } from '../../domain/types/eparagony-credentials.types';
import { EparagonyHttpClient } from '../http/eparagony-http-client';

const DEVICE_ACTIVE = 'ACTIVE';

export class EparagonyConnectionTesterAdapter implements ConnectionTesterPort {
  private readonly logger = new Logger(EparagonyConnectionTesterAdapter.name);

  constructor(private readonly http: HttpTransportFactoryPort) {}

  async test(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      if (!connection.credentialsRef) {
        return {
          success: false,
          message: 'Connection has no stored credentials',
          latencyMs: Date.now() - startedAt,
        };
      }

      const credentials = await credentialsResolver.get<EparagonyCredentials>(
        connection.credentialsRef,
      );
      const config = readEparagonyConnectionConfig(connection.config);
      const hosts = resolveEparagonyHosts(config, connection.id);

      const client = new EparagonyHttpClient(
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
        this.logger,
        // Connection-bound outbound transport (#1810) - an operator can click
        // "Test connection" repeatedly, and the vendor rate-limits its token
        // endpoint per IP.
        this.http.forConnection(connection),
      );

      // Never replay a cached token: the operator is asking whether the
      // credentials they just saved actually work.
      client.invalidateToken();
      await client.ensureToken();

      const deviceNote = await this.describeDevice(client, config);

      return {
        success: true,
        status: 200,
        message: `Credentials accepted and the requested scopes were granted.${deviceNote}`,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return this.toFailure(error, Date.now() - startedAt);
    }
  }

  /**
   * Best-effort device liveness note. Returns extra text for the success
   * message, or an empty string. Never throws and never turns a good credential
   * check into a failure.
   */
  private async describeDevice(
    client: EparagonyHttpClient,
    config: EparagonyConnectionConfig,
  ): Promise<string> {
    const device = config.fiscalDeviceUniqueNumber?.trim();
    if (device === undefined || device.length === 0) {
      return '';
    }
    try {
      const { data } = await client.get<EparagonyPrinterStatusResponse>(
        `printers/${encodeURIComponent(device)}/status`,
      );
      const status = typeof data?.status === 'string' ? data.status.trim().toUpperCase() : null;
      if (status === DEVICE_ACTIVE) {
        return ` Fiscal device ${device} was seen active recently.`;
      }
      return (
        ` Fiscal device ${device} reports "${status ?? 'unknown'}" - it may be offline, or this may be ` +
        `a sandbox with no device attached. This does not affect the connection itself.`
      );
    } catch (error) {
      this.logger.warn(
        `eparagony.pl device status probe failed for ${device}: ${describe(error)}`,
      );
      return ` The fiscal device status could not be read; this does not affect the connection itself.`;
    }
  }

  private toFailure(error: unknown, latencyMs: number): ConnectionTestResult {
    if (error instanceof EparagonyApiError) {
      // `message` is bounded and secret-free by construction; `responseBody` is a
      // separate field that may restate submitted data and never reaches here.
      return { success: false, status: error.statusCode, message: error.message, latencyMs };
    }
    if (error instanceof EparagonyConfigException) {
      return { success: false, message: error.reason, latencyMs };
    }
    if (error instanceof EparagonyNetworkError) {
      return { success: false, message: error.message, latencyMs };
    }
    // Anything else (credential resolution, an unexpected runtime failure)
    // collapses to a fixed string so no internal detail leaks to the operator.
    return { success: false, message: 'eparagony.pl probe failed', latencyMs };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
