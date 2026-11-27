/**
 * Request-not-sent classification (#4041)
 *
 * A write that fails at the transport layer is normally AMBIGUOUS: the request
 * may have reached the server and committed before the connection died. A few
 * failures prove the opposite - the request never left this machine (the name
 * did not resolve, nothing was listening, the connection was refused). For
 * those, and only those, a caller may safely re-send a non-idempotent write.
 *
 * The rule is deliberately a closed allowlist of Node error codes, never an
 * inference from a message: a wrong "not sent" verdict on a write that was
 * actually received applies it twice. `fetch failed` alone proves nothing (it
 * is undici's message for every transport failure, timeouts and resets
 * included), so it counts only through the `cause` it carries. Timeouts,
 * resets, aborts and every `UND_ERR_*` code are NOT in the list: each can occur
 * after the request was written to the socket.
 *
 * HTTP clients mark the final exception with {@link markRequestNotSent} only
 * when EVERY attempt they made was provably unsent; consumers read the mark
 * back with {@link isRequestNotSentError}.
 *
 * @module libs/shared/src/http
 */

/**
 * Node/undici error codes that occur strictly before a request is written:
 * DNS resolution failed or the TCP connection was refused.
 */
export const REQUEST_NOT_SENT_ERROR_CODES = ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN'] as const;

const MAX_CAUSE_DEPTH = 5;
const MARKER = 'requestNotSent';

type ErrorLike = {
  code?: unknown;
  cause?: unknown;
  originalError?: unknown;
  errors?: unknown;
};

function isErrorLike(value: unknown): value is ErrorLike {
  return typeof value === 'object' && value !== null;
}

function unsentCode(code: unknown): boolean {
  return (
    typeof code === 'string' &&
    (REQUEST_NOT_SENT_ERROR_CODES as readonly string[]).includes(code)
  );
}

function provablyUnsent(error: unknown, depth: number): boolean {
  if (!isErrorLike(error) || depth > MAX_CAUSE_DEPTH) {
    return false;
  }
  // An AggregateError (happy-eyeballs: one attempt per address family) is
  // unsent only when EVERY member is; a single unknown member could have sent.
  if (Array.isArray(error.errors) && error.errors.length > 0) {
    return error.errors.every((member) => provablyUnsent(member, depth + 1));
  }
  if (unsentCode(error.code)) {
    return true;
  }
  return provablyUnsent(error.cause, depth + 1);
}

/**
 * True when a raw transport error (as thrown by `fetch`) proves the request
 * never left this process. Conservative: anything not on the allowlist, and
 * any chain that ends without a recognised code, is `false`.
 */
export function isProvablyUnsentTransportError(error: unknown): boolean {
  return provablyUnsent(error, 0);
}

/** Flag an exception as "the request provably never left". Returns it. */
export function markRequestNotSent<T extends Error>(error: T): T {
  Object.defineProperty(error, MARKER, { value: true, enumerable: false, configurable: true });
  return error;
}

/**
 * Withdraw the mark. For a hop that follows a received response (a redirect):
 * the first hop was answered, so a later hop failing to connect says nothing
 * about whether the first one was processed.
 */
export function clearRequestNotSent<T>(error: T): T {
  if (isErrorLike(error) && (error as Record<string, unknown>)[MARKER] === true) {
    Object.defineProperty(error, MARKER, { value: false, enumerable: false, configurable: true });
  }
  return error;
}

/** True when {@link markRequestNotSent} was applied to the error or to its cause chain. */
export function isRequestNotSentError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && isErrorLike(current); depth++) {
    if ((current as Record<string, unknown>)[MARKER] === true) {
      return true;
    }
    current = current.cause ?? current.originalError;
  }
  return false;
}
