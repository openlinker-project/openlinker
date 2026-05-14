/**
 * Customer Identity Types
 *
 * Type definitions for customer identity resolution operations. Defines identity
 * modes, resolution requests, and results used in customer identity resolution.
 *
 * @module libs/core/src/customers/domain/types
 */

/**
 * Customer identity mode values
 *
 * Runtime array of all valid identity mode values. Used for validation,
 * Swagger documentation, and UI dropdowns.
 */
export const CustomerIdentityModeValues = ['external_only', 'email_fallback'] as const;

/**
 * Customer identity mode
 *
 * Derived union type from CustomerIdentityModeValues. Provides type safety
 * without runtime overhead.
 */
export type CustomerIdentityMode = (typeof CustomerIdentityModeValues)[number];

/**
 * Default identity mode used when the `OL_CUSTOMER_IDENTITY_MODE` env var is
 * absent, blank, or invalid. Exported so call sites can reference the default
 * by name rather than repeating the bare `'email_fallback'` literal (#668).
 */
export const DEFAULT_CUSTOMER_IDENTITY_MODE: CustomerIdentityMode = 'email_fallback';

/**
 * Customer identity resolution request
 *
 * Contains information needed to resolve customer identity from external buyer data.
 */
export interface CustomerIdentityResolutionRequest {
  /**
   * External buyer ID from source platform (e.g., Allegro buyer ID)
   */
  externalBuyerId: string;

  /**
   * Email address from source platform (for email fallback mode)
   */
  email: string;

  /**
   * Source connection ID (where the order/buyer data comes from)
   */
  sourceConnectionId: string;
}

/**
 * Customer identity resolution result
 *
 * Contains the resolved internal customer ID and metadata about the resolution.
 */
export interface CustomerIdentityResolutionResult {
  /**
   * Resolved internal customer ID
   */
  internalCustomerId: string;

  /**
   * Whether email fallback was used (true if external mapping not found and fallback used)
   */
  usedEmailFallback: boolean;

  /**
   * Whether collision was detected (emailHash matched >1 customer)
   */
  collisionDetected: boolean;
}
