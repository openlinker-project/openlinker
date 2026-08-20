/**
 * FX HTTP Client
 *
 * The house fetch idiom for this package: a thin wrapper over an INJECTED
 * `FetchLike` that adds a timeout and returns the raw status plus body text,
 * leaving every status-to-domain-error decision to the adapter that made the
 * call. That split matters because the two providers disagree about what a
 * status MEANS - NBP answers `404` on a non-publication day while ECB answers
 * `200` with a zero-byte body - so a shared "throw on non-2xx" helper would
 * force one of them to unpick its own error taxonomy from an exception.
 *
 * Body text, never parsed JSON: an ECB `400` returns a ~12 KB HTML error page,
 * so a client that eagerly parsed would throw a `SyntaxError` in place of the
 * adapter's terminal error.
 *
 * No retry loop lives here. Retry is the sync-job runner's job, driven by the
 * transient-versus-terminal split the adapters raise; a second, adapter-local
 * retry budget would multiply against `maxAttempts` (default 10) rather than
 * add to it.
 *
 * @module libs/integrations/fx/infrastructure/http
 */
import type { FetchLike } from '@openlinker/shared/http';

export const FX_DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Identifies OpenLinker to the public central-bank APIs.
 *
 * Not decorative. NBP and ECB are unauthenticated public endpoints, and the
 * usual mitigation against an anonymous UA-less client hammering one is a
 * throttle or an outright filter - which this package cannot absorb locally,
 * because it deliberately carries no retry loop (see the header). Naming the
 * caller is also what lets an operator be told which client to talk to instead
 * of being rate-limited without recourse.
 *
 * `undici` sends no default `user-agent` at all, so this header is the only one
 * either provider will ever see.
 */
export const FX_USER_AGENT =
  'OpenLinker/1.0 (+https://github.com/openlinker-project/openlinker; exchange-rate reader)';

/**
 * The 4xx codes that mean "come back later", not "your request is wrong".
 *
 * Kept HERE rather than in each adapter because both providers reach the same
 * conclusion from them and getting the classification wrong is asymmetrically
 * expensive: a transient answer costs a retry, whereas a wrongly-terminal one
 * writes the row's permanent `fxStampedAt` marker and the order silently never
 * receives a reported figure (#2135 review, finding 1).
 *
 *  - `429` is what a public unauthenticated API returns under a burst, which the
 *    sweep's sequential page walk can produce all by itself.
 *  - `408` is a server-side read timeout - the same class of event as the local
 *    `AbortError` the transport already maps to transient.
 */
export const FX_TRANSIENT_STATUS_CODES: readonly number[] = [408, 429];

/**
 * Whether `status` should be retried rather than treated as a terminal answer
 * about the pair. `>= 500` plus the two codes above; every other 4xx is the
 * adapter's own decision.
 */
export function isTransientFxStatus(status: number): boolean {
  return status >= 500 || FX_TRANSIENT_STATUS_CODES.includes(status);
}

export interface FxHttpResponse {
  readonly status: number;
  readonly body: string;
}

/**
 * Raised for anything that says nothing about the request itself - a socket
 * error, a DNS failure, an abort. The caller maps it onto
 * `RateUnavailableTransientError`; it is never surfaced to core directly.
 */
export class FxTransportError extends Error {
  constructor(
    public readonly url: string,
    public readonly cause: unknown
  ) {
    super(`Exchange-rate request to ${url} failed: ${describe(cause)}`);
    this.name = 'FxTransportError';
  }
}

function describe(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.name === 'AbortError' ? 'request timed out' : cause.message;
  }
  return String(cause);
}

/**
 * GET `url`, returning the status and the body as text.
 *
 * @throws FxTransportError on a network failure or a timeout
 */
export async function fxGet(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number = FX_DEFAULT_TIMEOUT_MS
): Promise<FxHttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        accept: 'application/json, text/csv, */*',
        'user-agent': FX_USER_AGENT,
      },
    });
    const body = await response.text();
    return { status: response.status, body };
  } catch (error) {
    throw new FxTransportError(url, error);
  } finally {
    clearTimeout(timer);
  }
}
