/**
 * API error envelope
 *
 * The shape of every error response the API sends (#3860), and the one rule
 * that decides its `code`. Framework-free on purpose: plugins import
 * `@openlinker/shared/errors`, so the Nest-specific exception that produces
 * this shape lives in `apps/api`.
 *
 * The rule is additive. A body keeps every field it already had; only a
 * missing `code` is filled in, so no existing client breaks.
 *
 * @module libs/shared/src/errors
 */
import { httpStatusErrorCode } from './api-error-code.types';

/** Values to put into the frontend's copy. Inputs, never sentences. */
export type ApiErrorParams = Record<string, string | number | boolean>;

/** One invalid field of a request body (filled by #3861). */
export interface ApiErrorField {
  /** Dotted path into the request body, e.g. `items.0.quantity`. */
  path: string;
  code: string;
  params?: ApiErrorParams;
}

export interface ApiErrorEnvelope {
  statusCode: number;
  /**
   * A stable machine code. An `ApiErrorCode` for errors minted by the API's
   * own error layer; until #3863 registers them, the codes some endpoints
   * already send (`ORDER_ALREADY_ON_HOLD`, `version_conflict` ...) pass through
   * as they are, which is why the type is a plain string.
   */
  code: string;
  params?: ApiErrorParams;
  /** English, for developers and logs only. The frontend shows copy chosen by `code`. */
  message: string | string[];
  fields?: ApiErrorField[];
  /**
   * An external system's own words (code `PROVIDER_REJECTED`). Shown behind a
   * translated prefix and never translated; never carries buyer data (#3864).
   */
  providerMessage?: string;
  /** Kept for existing clients: an exception name, a Nest status title or a legacy code. */
  error?: string;
}

/** A legacy code sent in `error`: upper snake case, e.g. `ORDER_ALREADY_ON_HOLD`. */
const LEGACY_ERROR_CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

/**
 * The code for an error body:
 * 1. the body's own non-empty `code`;
 * 2. a legacy code in `error` (upper snake case only - an exception class
 *    name or a Nest title such as `Not Found` is not a code);
 * 3. the status family, `HTTP_<status>`.
 */
export function resolveApiErrorCode(
  body: Readonly<Record<string, unknown>>,
  status: number
): string {
  const { code, error } = body;
  if (typeof code === 'string' && code.length > 0) return code;
  if (typeof error === 'string' && LEGACY_ERROR_CODE.test(error)) return error;
  return httpStatusErrorCode(status);
}

/** The body with its `code` filled in by `resolveApiErrorCode`. Never mutates the input. */
export function withApiErrorCode<T extends Record<string, unknown>>(
  body: T,
  status: number
): T & { code: string } {
  return { ...body, code: resolveApiErrorCode(body, status) };
}
