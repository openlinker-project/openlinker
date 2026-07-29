/**
 * Health Check Timeout Utility
 *
 * Shared timeout wrapper for health-check probes (#1619 review follow-up).
 * Every probe that reaches an external dependency (PostgreSQL, Redis,
 * PrestaShop, an infra-bearing connection's `ConnectionTesterPort`, …) must
 * race against a bounded timeout so a slow/hanging dependency can't stall
 * the whole health rollup. Extracted from `DevStackHealthService` so
 * `ConnectionInfraHealthService` shares the exact same behavior instead of
 * hand-rolling its own.
 *
 * @module apps/api/src/health
 */

/**
 * Thrown when a wrapped promise does not settle within the given timeout.
 * Callers can distinguish a genuine timeout from an ordinary probe failure
 * (e.g. "unsupported adapter") to report a more specific health status.
 */
export class HealthCheckTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HealthCheckTimeoutError';
  }
}

export const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Races `promise` against a timer; rejects with {@link HealthCheckTimeoutError}
 * if the timer wins first. Always clears the timer, whichever wins.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  message: string,
  timeoutMs: number = DEFAULT_HEALTH_CHECK_TIMEOUT_MS
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new HealthCheckTimeoutError(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
