/**
 * Allegro Ambiguous Write Exception
 *
 * Raised when a NON-idempotent write (`POST`/`PATCH` without an
 * `idempotent: true` opt-in, #3469) fails with an ambiguous outcome — a `5xx`
 * or a network/timeout error — that MAY have already committed server-side.
 * `AllegroHttpClient` refuses to auto-retry it internally (#3469), but the
 * failure still propagates out of the job that called it, and
 * `SyncJobRunner` retries any job-level failure by default. Without a
 * distinct type, `AllegroRetryClassifierAdapter.isNonRetryable` could not
 * tell this apart from an ordinary retryable `AllegroApiException`, so the
 * runner re-ran the whole job and the same non-idempotent POST went out
 * again — the exact duplicate (`POST /sale/product-offers` creating a second
 * live offer, #2039) #3469 exists to stop, just moved one layer up.
 *
 * Extends `AllegroApiException` (rather than a bare `Error`) so every
 * existing `instanceof AllegroApiException` consumer — validation-error
 * mapping, status-code reads — keeps working unchanged; this type only adds
 * a signal `AllegroRetryClassifierAdapter` can act on.
 *
 * @module libs/integrations/allegro/src/domain/exceptions
 */
import { AllegroApiException } from './allegro-api.exception';
import type { AllegroValidationError } from '../types/allegro-api.types';

export class AllegroAmbiguousWriteException extends AllegroApiException {
  constructor(
    message: string,
    public readonly method: string,
    public readonly path: string,
    statusCode?: number,
    responseBody?: string,
    url?: string,
    allegroErrors?: AllegroValidationError[],
  ) {
    super(message, statusCode, responseBody, url, allegroErrors);
    this.name = 'AllegroAmbiguousWriteException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AllegroAmbiguousWriteException);
    }
  }
}
