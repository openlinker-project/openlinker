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
 *
 * Kept deliberately narrow: the registry ORs every registered classifier's
 * answer, so a broad `instanceof WooCommerceHttpResponseException` rule here
 * would make every transient WooCommerce failure terminal, not just this one
 * ambiguous-create case.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters
 * @implements {RetryClassifierPort}
 */
import type { RetryClassifierPort } from '@openlinker/core/sync';
import { WooCommerceOrderCreateAmbiguousException } from '../../domain/exceptions/woocommerce-order-create-ambiguous.exception';

export class WooCommerceRetryClassifierAdapter implements RetryClassifierPort {
  isNonRetryable(cause: unknown): boolean {
    return cause instanceof WooCommerceOrderCreateAmbiguousException;
  }
}
