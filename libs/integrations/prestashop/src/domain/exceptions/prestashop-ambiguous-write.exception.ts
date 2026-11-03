/**
 * PrestaShop Ambiguous Write Exception
 *
 * Raised when a NON-idempotent write — a Webservice `createResource` (POST)
 * without an `idempotent: true` opt-in, or the OL module's `importOrder`
 * (validateOrder) call — fails with an ambiguous outcome (an ambiguous
 * `5xx` or a network/timeout error) that MAY have already committed
 * server-side (#3469). `PrestashopWebserviceClient` / `createOrder` already
 * refuse to auto-retry such a call internally, but the failure still
 * propagates out of the job that called it, and `SyncJobRunner` retries any
 * job-level failure by default unless a registered classifier says
 * otherwise. Without a distinct type, `PrestashopRetryClassifierAdapter`
 * could not tell this apart from an ordinary retryable `PrestashopApiException`,
 * so the runner re-ran the whole job and the same non-idempotent POST went
 * out again — a duplicate customer/address/cart/order-history row, or (for
 * `createOrder`, once the by-reference recovery lookup ALSO failed to find
 * what may have been created) a second PrestaShop order.
 *
 * Extends `PrestashopApiException` so every existing `instanceof
 * PrestashopApiException` consumer keeps working; this type only adds a
 * signal `PrestashopRetryClassifierAdapter` can act on.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
import { PrestashopApiException } from './prestashop-api.exception';

export class PrestashopAmbiguousWriteException extends PrestashopApiException {
  constructor(
    message: string,
    public readonly method: string,
    public readonly resource: string,
    statusCode?: number,
    responseBody?: string,
  ) {
    super(message, statusCode, responseBody);
    this.name = 'PrestashopAmbiguousWriteException';
    Error.captureStackTrace(this, this.constructor);
  }
}
