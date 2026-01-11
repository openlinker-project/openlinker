/**
 * Customer Projection Types
 *
 * Type definitions for customer projection operations. Defines address types,
 * projection DTOs, and related types used in customer projection domain.
 *
 * @module libs/core/src/customers/domain/types
 */

/**
 * Address type values
 *
 * Runtime array of all valid address type values. Used for validation,
 * Swagger documentation, and UI dropdowns.
 */
export const AddressTypeValues = ['shipping', 'billing'] as const;

/**
 * Address type
 *
 * Derived union type from AddressTypeValues. Provides type safety
 * without runtime overhead.
 */
export type AddressType = (typeof AddressTypeValues)[number];
