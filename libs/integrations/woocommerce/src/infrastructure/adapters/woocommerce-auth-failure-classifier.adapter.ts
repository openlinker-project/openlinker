/**
 * WooCommerce Auth Failure Classifier Adapter
 *
 * Implements `AuthFailureClassifierPort` (#819) for the WooCommerce platform.
 * Answers the sync-runner's "does this terminal failure mean the connection's
 * credentials were rejected (re-authentication required)?" question.
 *
 * Credential-rejection (return `true`):
 *   - `WooCommerceUnauthorizedException` — thrown by the HTTP client for HTTP 401/403.
 *     Signals that the consumer key / secret is invalid or lacks required WC API scope.
 *   - `WooCommerceAuthFailureException` — re-thrown by the order-processor adapter
 *     when a 401/403 occurs during customer provisioning or order creation. Same
 *     underlying cause, different throw site.
 *
 * Everything else (return `false`):
 *   - 4xx validation / not-found errors — business/data problems, not credential rejections.
 *   - Network / timeout errors — transient, not credential rejections.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters
 * @implements {AuthFailureClassifierPort}
 */
import type { AuthFailureClassifierPort } from '@openlinker/core/sync';
import { WooCommerceUnauthorizedException } from '../../domain/exceptions/woocommerce-unauthorized.exception';
import { WooCommerceAuthFailureException } from '../../domain/exceptions/woocommerce-auth-failure.exception';

export class WooCommerceAuthFailureClassifierAdapter implements AuthFailureClassifierPort {
  isCredentialRejected(cause: unknown): boolean {
    return (
      cause instanceof WooCommerceUnauthorizedException ||
      cause instanceof WooCommerceAuthFailureException
    );
  }
}
