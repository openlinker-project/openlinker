/**
 * EparagonyApiError
 *
 * Thrown for a non-2xx response from the Documents REST API.
 *
 * Carries the neutral `failureMode` discriminator core's `FiscalRegistrationService`
 * reads STRUCTURALLY off the throwable (ADR-042 decision 7) - core never
 * value-imports this class - plus a short, PII-free `reason` core stamps on the
 * record as the operator-facing summary of a terminal rejection.
 *
 * The default classification is deliberately asymmetric and is stated once here
 * so no call site has to re-derive it:
 *
 *   - `4xx` other than `422` and `429` -> `'rejected'`. The request was refused
 *     at the API boundary, so no document and no fiscal registration was created.
 *     Re-crossing the boundary is safe: OL sends its own `idempotencyKey` as the
 *     vendor's `Idempotency-Key`, and the vendor guarantees that repeating a key
 *     with the same data cannot mint a second registration.
 *   - `422` -> `'in-doubt'`. The vendor returns it when the SAME key is replayed
 *     with DIFFERENT data, which means a document already exists under that key.
 *     Reading that as `'rejected'` would be the exact wrong-direction error this
 *     taxonomy exists to prevent.
 *   - `429` and `5xx` -> `'in-doubt'`. The vendor documents 502/503/504 as
 *     retry-worthy; either may have been raised after the document was created.
 *
 * A caller with better information (e.g. a status read that returned a terminal
 * `ERROR`) constructs the error with an explicit mode instead.
 *
 * @module libs/integrations/eparagony/src/domain/exceptions
 */
import type { EparagonyErrorBody } from '../types/eparagony-api.types';

export type EparagonyFailureMode = 'rejected' | 'in-doubt';

/** Upper bound on the operator-facing `reason`; core truncates again at 200. */
const MAX_REASON_LENGTH = 200;

export class EparagonyApiError extends Error {
  /** Neutral discriminator read structurally by core. */
  readonly failureMode: EparagonyFailureMode;

  /**
   * Short, PII-free operator-facing summary. Core reads it structurally for a
   * terminal rejection. Never the raw response body - a vendor error message can
   * echo submitted line names.
   */
  readonly reason: string;

  /** Vendor `errorCode`, when the body carried one. Open set - never switched exhaustively. */
  readonly errorCode: number | null;

  constructor(
    message: string,
    readonly statusCode: number,
    readonly responseBody: EparagonyErrorBody | string | null,
    options?: { failureMode?: EparagonyFailureMode; reason?: string },
  ) {
    super(message);
    this.name = 'EparagonyApiError';
    this.errorCode = readErrorCode(responseBody);
    this.failureMode = options?.failureMode ?? defaultFailureMode(statusCode);
    this.reason = (options?.reason ?? defaultReason(statusCode, this.errorCode)).slice(
      0,
      MAX_REASON_LENGTH,
    );
    Error.captureStackTrace(this, this.constructor);
  }

  isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  isServerError(): boolean {
    return this.statusCode >= 500;
  }

  /** `401`/`403` - the credentials or the granted scope set were rejected. */
  isAuthRejection(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

function defaultFailureMode(statusCode: number): EparagonyFailureMode {
  if (statusCode === 422 || statusCode === 429) {
    return 'in-doubt';
  }
  return statusCode >= 400 && statusCode < 500 ? 'rejected' : 'in-doubt';
}

function defaultReason(statusCode: number, errorCode: number | null): string {
  const suffix = errorCode === null ? '' : ` (code ${errorCode})`;
  if (statusCode === 401 || statusCode === 403) {
    return `The e-receipt provider rejected the connection's credentials or granted scopes${suffix}.`;
  }
  if (statusCode === 422) {
    return `The e-receipt provider reports this registration key was already used with different data${suffix}.`;
  }
  if (statusCode === 429) {
    return `The e-receipt provider rate-limited the request${suffix}.`;
  }
  if (statusCode >= 500) {
    return `The e-receipt provider returned a server error${suffix}.`;
  }
  return `The e-receipt provider rejected the document${suffix}.`;
}

/**
 * Pull `errorCode` out of a response body without assuming the body is JSON, is
 * an object, or carries the field at all.
 */
function readErrorCode(body: EparagonyErrorBody | string | null): number | null {
  if (body === null || typeof body === 'string') {
    return null;
  }
  const raw = body.errorCode;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}
