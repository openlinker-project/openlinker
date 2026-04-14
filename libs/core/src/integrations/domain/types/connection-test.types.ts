/**
 * Connection Test Types
 *
 * Result shape returned by ConnectionTesterPort implementations when probing
 * a live connection. Consumed by the API layer and rendered in the Connection
 * detail page.
 *
 * @module libs/core/src/integrations/domain/types
 */

export interface ConnectionTestResult {
  success: boolean;
  /** HTTP status code of the probe request, when one was issued. */
  status?: number;
  /** Human-readable outcome ("OK", "401 Unauthorized", …). Safe to display. */
  message: string;
  /** End-to-end latency of the probe in milliseconds. */
  latencyMs: number;
}
