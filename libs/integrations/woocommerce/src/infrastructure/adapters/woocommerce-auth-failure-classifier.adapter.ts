/**
 * WooCommerce Auth Failure Classifier Adapter
 *
 * Returns true only for WooCommerceUnauthorizedException — thrown by
 * WooCommerceHttpClient on 401/403. These signal a revoked or
 * insufficient-scope consumer key/secret.
 *
 * Transient network errors and 5xx responses are not credential rejections —
 * they propagate as other WooCommerce exception types and are handled by the
 * retry classifier.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters
 * @implements {AuthFailureClassifierPort}
 */
import type { AuthFailureClassifierPort } from '@openlinker/core/sync';
import { WooCommerceUnauthorizedException } from '../../domain/exceptions/woocommerce-unauthorized.exception';

export class WooCommerceAuthFailureClassifierAdapter implements AuthFailureClassifierPort {
  isCredentialRejected(cause: unknown): boolean {
    return cause instanceof WooCommerceUnauthorizedException;
  }
}
