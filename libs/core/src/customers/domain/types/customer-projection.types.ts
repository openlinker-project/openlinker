/**
 * Customer Projection Types
 *
 * Type definitions for customer projection operations. Defines address types,
 * projection DTOs, and related types used in customer projection domain.
 *
 * @module libs/core/src/customers/domain/types
 */
import type { CustomerProjection } from '../entities/customer-projection.entity';

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

/**
 * Customer projection list filters
 * Criteria for querying the internal customer projection store. All fields are optional.
 */
export interface CustomerProjectionFilters {
  /** Case-insensitive search on emailHash, normalizedEmail, firstName, or lastName */
  search?: string;
  /** Filter by last source connection ID */
  lastSourceConnectionId?: string;
}

/**
 * Offset-based pagination parameters for customer projections
 */
export interface CustomerProjectionPagination {
  /** Number of items to return (1–100) */
  limit: number;
  /** Number of items to skip */
  offset: number;
}

/**
 * Paginated customer projections result
 */
export interface PaginatedCustomerProjections {
  items: CustomerProjection[];
  total: number;
}
