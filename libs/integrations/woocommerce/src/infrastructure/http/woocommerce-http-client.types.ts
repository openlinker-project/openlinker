/**
 * WooCommerce HTTP Client Types
 *
 * Type definitions for the `WooCommerceHttpClient` retry configuration.
 * Extracted from the client implementation per the "types in separate files"
 * rule (engineering-standards.md § Type Definitions in Separate Files).
 *
 * The retry loop itself is implemented in #874 alongside typed domain
 * exceptions (`WooCommerceUnauthorizedException`, etc.). The interface is
 * defined here at scaffold stage so capability adapters in #874+ can pass
 * production retry settings without a constructor signature change.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/http
 */

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}
