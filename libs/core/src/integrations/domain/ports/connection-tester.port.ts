/**
 * Connection Tester Port
 *
 * Contract for a lightweight, adapter-specific liveness/credentials probe.
 * Each platform integration provides an implementation that hits a cheap,
 * authenticated endpoint (e.g. PrestaShop `GET /api/products?limit=1`,
 * Allegro `GET /me`) and reports the outcome in a structured, UI-safe shape.
 *
 * Implementations MUST NOT throw on adapter/HTTP errors — they translate
 * failure into a `ConnectionTestResult` with `success: false`.
 *
 * @module libs/core/src/integrations/domain/ports
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from './credentials-resolver.port';
import type { ConnectionTestResult } from '../types/connection-test.types';

export interface ConnectionTesterPort {
  /**
   * Probe the connection and return a structured result.
   *
   * @param connection - The connection to probe.
   * @param credentialsResolver - Resolver for fetching credentials.
   */
  test(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort
  ): Promise<ConnectionTestResult>;
}
