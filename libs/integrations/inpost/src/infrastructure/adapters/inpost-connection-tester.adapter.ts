/**
 * InPost Connection Tester Adapter (#771)
 *
 * Implements `ConnectionTesterPort` for InPost connections. Performs a cheap
 * authenticated probe against `GET /v1/points?per_page=1` (the same read-only
 * ShipX endpoint `findPickupPoints` uses) to validate that the stored ShipX
 * Bearer token + environment base URL still work.
 *
 * Never throws — all failures (invalid/under-provisioned config, auth
 * rejection, transport error) are translated into a structured
 * `ConnectionTestResult` with `success: false`. Reuses the adapter factory's
 * `BASE_URLS` / `extractConfig` / `resolveApiToken` helpers so the base-URL map
 * and config/credentials resolution stay single-sourced. The probe client runs
 * with `maxRetries: 0` so a stale token surfaces as an immediate, clear failure.
 *
 * **Scope, by design (#1807):** this validates connectivity + auth only — it
 * never exercises `POST /v1/organizations/:org/shipments`, so it cannot detect
 * (and was never intended to detect) shipment-payload-specific rejections such
 * as an unrecognised `target_point` (a paczkomat id ShipX doesn't have on
 * file), a bad parcel dimension, or any other per-request validation error.
 * ShipX has no side-effect-free "validate this shipment" endpoint, and
 * generating a real throwaway shipment on every connection test to exercise
 * that path would create real (and, in production, billable) carrier-side
 * artifacts — not a reasonable trade for a generic health check. A green
 * "Test Connection" therefore means "the API token + environment are good",
 * **not** "the next label will generate" — a specific label can still fail on
 * fields only a live create-shipment call validates. See the InPost
 * troubleshooting section (`docs/setup-guide.md` § 5) for the confirmed
 * `target_point` failure mode this leaves undetected.
 *
 * @module libs/integrations/inpost/src/infrastructure/adapters
 * @implements {ConnectionTesterPort}
 */
import type {
  ConnectionTesterPort,
  ConnectionTestResult,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { BASE_URLS, extractConfig, resolveApiToken } from '../../application/inpost-adapter.factory';
import { InpostUnauthorizedException } from '../../domain/exceptions/inpost-unauthorized.exception';
import { InpostHttpClient } from '../http/inpost-http-client';

export class InpostConnectionTesterAdapter implements ConnectionTesterPort {
  async test(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      const config = extractConfig(connection);
      const apiToken = await resolveApiToken(connection, credentialsResolver);

      const client = new InpostHttpClient(BASE_URLS[config.environment], apiToken, {
        maxRetries: 0,
        initialDelayMs: 0,
        backoffMultiplier: 1,
        maxDelayMs: 0,
      });

      await client.request<unknown>({
        method: 'GET',
        path: '/v1/points',
        query: { per_page: 1 },
      });

      return {
        success: true,
        status: 200,
        message: 'OK',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        success: false,
        status: resolveStatus(error),
        message: error instanceof Error ? error.message : 'InPost probe failed',
        latencyMs: Date.now() - startedAt,
      };
    }
  }
}

/**
 * Best-effort HTTP status for the failure result. ShipX auth rejections (401 /
 * 403) map to `InpostUnauthorizedException`, surfaced here as `401`. Other
 * exceptions may carry a numeric `status`/`statusCode`; otherwise the status is
 * omitted and the operator reads the message.
 */
function resolveStatus(error: unknown): number | undefined {
  if (error instanceof InpostUnauthorizedException) {
    return 401;
  }
  const err = error as { statusCode?: number; status?: number };
  if (typeof err.statusCode === 'number') return err.statusCode;
  if (typeof err.status === 'number') return err.status;
  return undefined;
}
