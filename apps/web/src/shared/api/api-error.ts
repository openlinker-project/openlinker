/**
 * ApiError
 *
 * The error every API call rejects with. The message is the server's own text
 * when it sent one (server text is not translated here; error codes, #3860,
 * replace it), otherwise a fallback from the `ui.apiError` namespace in the
 * language active when the request failed.
 *
 * @module shared/api
 */
import { getMessages } from '../i18n';
import type { ApiErrorField, ApiErrorParams } from './api-error.types';

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;
  /** The body's stable machine code (#3860), or `undefined` when it sent none. */
  readonly code: string | undefined;
  /** The values the code's copy needs. Empty when the body sent none. */
  readonly params: ApiErrorParams;
  /** The invalid request-body fields (#3861). Empty when the body sent none. */
  readonly fields: readonly ApiErrorField[];
  /** An external system's own words (`PROVIDER_REJECTED`), shown verbatim. */
  readonly providerMessage: string | undefined;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    const body = isRecord(details) ? details : {};
    this.code = typeof body.code === 'string' && body.code.length > 0 ? body.code : undefined;
    this.params = readParams(body.params);
    this.fields = readFields(body.fields);
    this.providerMessage =
      typeof body.providerMessage === 'string' && body.providerMessage.length > 0
        ? body.providerMessage
        : undefined;
  }

  isUnauthorized(): boolean {
    return this.status === 401;
  }

  isForbidden(): boolean {
    return this.status === 403;
  }

  isNotFound(): boolean {
    return this.status === 404;
  }

  isConflict(): boolean {
    return this.status === 409;
  }

  isServerError(): boolean {
    return this.status >= 500;
  }

  isNetworkError(): boolean {
    return this.status === 0;
  }

  static fromResponse(response: Response, details: unknown): ApiError {
    if (typeof details === 'object' && details !== null && 'message' in details) {
      const message = Array.isArray(details.message) ? details.message.join(', ') : String(details.message);
      return new ApiError(message, response.status, details);
    }

    if (typeof details === 'string' && details.length > 0) {
      return new ApiError(details, response.status, details);
    }

    return new ApiError(response.statusText || getMessages('ui').apiError.requestFailed, response.status, details);
  }

  static fromNetworkFailure(cause: unknown): ApiError {
    const message = cause instanceof Error ? cause.message : getMessages('ui').apiError.networkFailed;
    return new ApiError(message, 0, cause);
  }

  /** The path stays in `details` for diagnostics; the message is operator copy. */
  static fromTimeout(path: string): ApiError {
    return new ApiError(getMessages('ui').apiError.timedOut, 0, { timeout: true, path });
  }
}

/**
 * True when `error` is a mutation failure a caller has NOT already surfaced
 * through its own recovery UI (a field error, a dedicated "in use" state) —
 * so a generic "Could not save" alert is the only place it will be shown.
 *
 * `isMapped` names the caller's own recognised-and-handled statuses (e.g.
 * `(e) => e.isConflict()`); anything else — a non-`ApiError`, or an `ApiError`
 * `isMapped` doesn't recognise — is unmapped and must still reach the user
 * somewhere, which is exactly what this predicate is for.
 *
 * Extracted after #3068 tech-review found `LocationDialog` and
 * `LocationDeleteDialog` computing this same "is this the one I already
 * handled" check inline, with the same shape and no shared source — a third
 * mutation dialog would otherwise have copied it a third time.
 */
export function isUnmappedApiError(error: unknown, isMapped: (apiError: ApiError) => boolean): boolean {
  return !(error instanceof ApiError && isMapped(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isParamValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** Keeps only scalar entries: anything else is not a param the copy can use. */
function readParams(value: unknown): ApiErrorParams {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => isParamValue(entry)));
}

function readFields(value: unknown): readonly ApiErrorField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ApiErrorField[] => {
    if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.code !== 'string') {
      return [];
    }
    const params = readParams(entry.params);
    return [
      Object.keys(params).length > 0
        ? { path: entry.path, code: entry.code, params }
        : { path: entry.path, code: entry.code },
    ];
  });
}
