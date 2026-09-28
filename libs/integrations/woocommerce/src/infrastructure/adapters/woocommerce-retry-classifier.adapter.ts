/**
 * WooCommerce Retry Classifier Adapter
 *
 * Implements `RetryClassifierPort` (#581) for the WooCommerce platform —
 * answers the worker runner's "is this error non-retryable?" question for
 * WooCommerce's own exception hierarchy. Self-registered by
 * `createWooCommercePlugin().register` against `RetryClassifierRegistryService`,
 * alongside the connection tester and the other registries.
 *
 * Non-retryable (return `true`):
 *   - `WooCommerceOrderCreateAmbiguousException` (#3469) — `POST /orders`
 *     answered 2xx with no `id`. The order may already exist on the shop, so
 *     retrying the non-idempotent create risks booking it twice; the failure
 *     needs an operator to check the shop, not another attempt.
 *   - `WooCommerceAmbiguousWriteException` (#3469 IMPORTANT-1 review) — a
 *     non-idempotent write (POST, no `idempotent: true`) whose REQUEST
 *     itself failed with an ambiguous 5xx/network error and MAY have
 *     already committed. `WooCommerceHttpClient` already refuses to retry it
 *     internally; classifying it here too is what stops `SyncJobRunner` from
 *     re-running the whole job and re-sending the same POST.
 *
 * Kept deliberately narrow: the registry ORs every registered classifier's
 * answer, so a broad `instanceof WooCommerceHttpResponseException` rule here
 * would make every transient WooCommerce failure terminal, not just these two
 * ambiguous-write cases.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters
 * @implements {RetryClassifierPort}
 */
import type { RetryClassifierPort } from '@openlinker/core/sync';
import { WooCommerceOrderCreateAmbiguousException } from '../../domain/exceptions/woocommerce-order-create-ambiguous.exception';
import { WooCommerceAmbiguousWriteException } from '../../domain/exceptions/woocommerce-ambiguous-write.exception';

export class WooCommerceRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    return (
      cause instanceof WooCommerceOrderCreateAmbiguousException ||
      cause instanceof WooCommerceAmbiguousWriteException
    );
  }
}
