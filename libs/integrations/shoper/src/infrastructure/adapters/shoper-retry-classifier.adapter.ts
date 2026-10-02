/**
 * Shoper Retry Classifier Adapter
 *
 * Tells the worker runner which Shoper failures are DETERMINISTIC - the same
 * input fails the same way every time - so the job goes terminal instead of
 * burning the whole retry ladder (ADR-007). Without it, every failure
 * defaults to retryable, and a sweep child for a mis-configured connection
 * would be retried ten times with backoff to six hours for nothing.
 *
 * Non-retryable:
 *   - `ShoperConfigException` - the connection's config or credentials are
 *     unusable; only an operator edit changes that.
 *   - `ShoperNotSupportedException` - a method this integration does not offer.
 *   - `ShoperNotMappedException` - the internal id has no Shoper id here; the
 *     same job re-run finds the same gap.
 *   - `ShoperWarehousesNotSupportedException` - the shop runs the multi-warehouse
 *     module; only an operator change alters that.
 *   - `ShoperVariantRequiredException` - a stock write on a multi-variant product
 *     with no variant named; the same call names none again.
 *   - `ShoperCustomerUnresolvableException` - the order carries no usable buyer
 *     email, which a retry cannot add.
 *   - `ShoperOrderUnbuildableException` - the order cannot be expressed on this
 *     shop (missing id, unknown currency or tax); deterministic.
 *   - `ShoperPartialOrderException` - retrying would create a second order.
 *   - `RangeError` - a window or offset the adapter's own sanity bounds reject.
 *   - `ShoperApiError` 4xx other than 404, 408 and 429 - the shop understood
 *     the request and refused it (`400` bad request, `401`/`403` credentials
 *     or scope, `422`). `401`/`403` are additionally surfaced to the operator
 *     as `needs_reauth` by the auth-failure classifier.
 *   - `ShoperApiError` 404 ONLY when it carries Shoper's own error envelope
 *     (`isResourceNotFound`): the shop said the resource is not there.
 *
 * Retryable (the default): `ShoperNetworkError`, a BARE 404, `408`, `429` and
 * every `5xx`. A bare 404 is retryable because it is ambiguous, not because it
 * is known to clear: a proxy or maintenance page does, a wrong `baseUrl` does
 * NOT. The latter is stopped earlier - the connection tester and the config
 * shape validator reject it at save time - so what reaches here is mostly the
 * transient kind. If a bad host does slip through, each job still ends on the
 * ordinary retry ladder (`maxAttempts`, then dead) rather than staling the
 * catalogue, which is the failure this classification exists to avoid.
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters
 * @implements {RetryClassifierPort}
 */
import type { RetryClassifierPort } from '@openlinker/core/sync';

import { ShoperApiError } from '../../domain/exceptions/shoper-api.error';
import { ShoperConfigException } from '../../domain/exceptions/shoper-config.exception';
import { ShoperCustomerUnresolvableException } from '../../domain/exceptions/shoper-customer-unresolvable.exception';
import { ShoperOrderUnbuildableException } from '../../domain/exceptions/shoper-order-unbuildable.exception';
import { ShoperPartialOrderException } from '../../domain/exceptions/shoper-partial-order.exception';
import { ShoperNotMappedException } from '../../domain/exceptions/shoper-not-mapped.exception';
import { ShoperNotSupportedException } from '../../domain/exceptions/shoper-not-supported.exception';
import { ShoperVariantRequiredException } from '../../domain/exceptions/shoper-variant-required.exception';
import { ShoperWarehousesNotSupportedException } from '../../domain/exceptions/shoper-warehouses-not-supported.exception';

const RETRYABLE_CLIENT_ERRORS: ReadonlySet<number> = new Set([408, 429]);

export class ShoperRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    if (
      cause instanceof ShoperConfigException ||
      cause instanceof ShoperNotSupportedException ||
      cause instanceof ShoperNotMappedException ||
      cause instanceof ShoperCustomerUnresolvableException ||
      cause instanceof ShoperOrderUnbuildableException ||
      cause instanceof ShoperPartialOrderException ||
      cause instanceof ShoperWarehousesNotSupportedException ||
      cause instanceof ShoperVariantRequiredException ||
      cause instanceof RangeError
    ) {
      return true;
    }
    if (cause instanceof ShoperApiError) {
      // A bare 404 - a proxy or maintenance page in front of the shop, a host
      // moved for a moment - is not Shoper's statement that anything is gone
      // (`isResourceNotFound`), and it clears on its own. Only a 404 carrying
      // Shoper's own envelope is a deterministic answer.
      if (cause.statusCode === 404) {
        return cause.isResourceNotFound();
      }
      return (
        cause.statusCode >= 400 &&
        cause.statusCode < 500 &&
        !RETRYABLE_CLIENT_ERRORS.has(cause.statusCode)
      );
    }
    return false;
  }
}
