/**
 * API error codes
 *
 * The stable machine codes an API error response carries in `code` (#3860).
 * The frontend picks its copy by code (ADR-081: the backend never sends
 * translated text), so a code is a contract: it is never renamed, and its
 * meaning never changes.
 *
 * `ApiErrorCodeValues` lists the codes the API mints by name. Later issues of
 * the error-code track add theirs here (#3861 validation, #3863 the domain
 * filters and the endpoints that already send a code). Every other error falls
 * back to its status family, `HTTP_<status>`.
 *
 * @module libs/shared/src/errors
 */

export const ApiErrorCodeValues = [
  /** An error the API did not anticipate; the body never carries its message. */
  'INTERNAL_ERROR',
  /** The request body failed validation; `fields` lists what failed and why (#3861). */
  'VALIDATION_FAILED',
] as const;

export type KnownApiErrorCode = (typeof ApiErrorCodeValues)[number];

/** The fallback for an error with no code of its own: `HTTP_404`, `HTTP_409` ... */
export type HttpStatusErrorCode = `HTTP_${number}`;

export type ApiErrorCode = KnownApiErrorCode | HttpStatusErrorCode;

export function httpStatusErrorCode(status: number): HttpStatusErrorCode {
  return `HTTP_${status}`;
}
