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
      headers: { accept: 'application/json, text/csv, */*' },
    });
    const body = await response.text();
    return { status: response.status, body };
  } catch (error) {
    throw new FxTransportError(url, error);
  } finally {
    clearTimeout(timer);
  }
}
