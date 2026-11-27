/**
 * Connection Test Types
 *
 * Result shape returned by ConnectionTesterPort implementations when probing
 * a live connection. Consumed by the API layer and rendered in the Connection
 * detail page.
 *
 * @module libs/core/src/integrations/domain/types
 */

/**
 * What a connection test found, as a code the frontend phrases in the
 * operator's language (#3866). `message` stays the tester's own English detail.
 */
export const ConnectionTestOutcomeValues = [
  /** The connection works. */
  'ok',
  /** The platform refused the credentials (401/403). */
  'unauthorized',
  /** The platform could not be reached at all. */
  'unreachable',
  /** The platform did not answer in time. */
  'timeout',
  /** The address answered 404: usually a wrong shop or API address. */
  'not-found',
  /** Required configuration or credentials are missing or invalid. */
  'misconfigured',
  /** The platform answered with a status the tester did not expect. */
  'unexpected-status',
  /** This kind of connection cannot be tested yet. */
  'unsupported',
  /** The test failed in a way the tester could not classify. */
  'failed',
] as const;

export type ConnectionTestOutcome = (typeof ConnectionTestOutcomeValues)[number];

export interface ConnectionTestResult {
  success: boolean;
  /** HTTP status code of the probe request, when one was issued. */
  status?: number;
  /** Human-readable outcome ("OK", "401 Unauthorized", …). Safe to display. */
  message: string;
  /** End-to-end latency of the probe in milliseconds. */
  latencyMs: number;
  /**
   * What the test found, when the tester knows better than the status alone
   * (#3866). Optional so a tester written before it still compiles;
   * {@link resolveConnectionTestOutcome} derives one when it is absent.
   */
  outcome?: ConnectionTestOutcome;
}

/**
 * The outcome a result reports, or one derived from its status: the tester's
 * own `outcome` wins, then a success is `ok`, 401/403 `unauthorized`, 404
 * `not-found`, 408/504 `timeout`, any other status `unexpected-status`, and a
 * failure with neither is `failed` - never a guess at a cause the tester did
 * not report.
 */
export function resolveConnectionTestOutcome(result: ConnectionTestResult): ConnectionTestOutcome {
  if (result.outcome !== undefined) return result.outcome;
  if (result.success) return 'ok';
  const { status } = result;
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not-found';
  if (status === 408 || status === 504) return 'timeout';
  if (status !== undefined) return 'unexpected-status';
  return 'failed';
}
