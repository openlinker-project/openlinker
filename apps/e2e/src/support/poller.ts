/**
 * Deterministic polling helpers
 *
 * The suite never sleeps for a fixed "eventually synced" duration. Instead,
 * every asynchronous checkpoint is driven by explicitly triggering the relevant
 * job and then polling OL state (API or UI) until a bounded predicate holds.
 * `pollUntil` centralises that loop with a clear timeout message so a failure
 * says *what* never became true, not just "timed out".
 *
 * @module support
 */

export interface PollOptions {
  /** Total budget before giving up (ms). Default 30s. */
  timeoutMs?: number;
  /** Delay between attempts (ms). Default 1s. */
  intervalMs?: number;
  /** Human-readable description of what is awaited, used in the timeout error. */
  message?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_INTERVAL_MS = 1_000;

export class PollTimeoutError extends Error {
  constructor(message: string, readonly lastError?: unknown) {
    super(message);
    this.name = 'PollTimeoutError';
  }
}

/**
 * Repeatedly invoke `probe` until it returns a non-null/defined, truthy-checked
 * value via `predicate`, or the timeout elapses. Returns the accepted value.
 *
 * Errors thrown by `probe` are swallowed and retried (e.g. a 404 while a
 * resource is still being created) until the timeout, at which point the last
 * error is attached to the thrown `PollTimeoutError`.
 */
export async function pollUntil<T>(
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: PollOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const message = options.message ?? 'condition to hold';
  const deadline = Date.now() + timeoutMs;

  let lastError: unknown;
  let lastValue: T | undefined;

  while (Date.now() < deadline) {
    try {
      const value = await probe();
      lastValue = value;
      if (predicate(value)) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }

  const detail = lastError
    ? ` Last error: ${describe(lastError)}`
    : lastValue !== undefined
      ? ` Last value: ${describe(lastValue)}`
      : '';
  throw new PollTimeoutError(
    `Timed out after ${timeoutMs}ms waiting for ${message}.${detail}`,
    lastError,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** The polling helper surface exposed to specs via the `poll` fixture. */
export interface Poller {
  until: typeof pollUntil;
}

export const poller: Poller = { until: pollUntil };
