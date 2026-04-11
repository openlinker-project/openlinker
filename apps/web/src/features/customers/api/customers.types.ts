/**
 * Customers Feature Types
 *
 * Frontend transport types for the customers API. Mirrors the backend
 * CustomerProjectionResponseDto and PaginatedCustomersResponseDto contracts.
 * All date fields are ISO 8601 strings.
 *
 * @module apps/web/src/features/customers/api
 */

export interface CustomerAddress {
  addressHash: string;
  addressType: string;
  address1: string | null;
  address2: string | null;
  city: string | null;
  postcode: string | null;
  countryIso2: string | null;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerProjection {
  internalCustomerId: string;
  emailHash: string;
  normalizedEmail: string | null;
  firstName: string | null;
  lastName: string | null;
  lastSeenAt: string;
  lastSourceConnectionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerProjectionDetail extends CustomerProjection {
  addresses: CustomerAddress[];
}

export interface CustomerFilters {
  search?: string;
  lastSourceConnectionId?: string;
}

export interface CustomerPagination {
  limit?: number;
  offset?: number;
}

export interface PaginatedCustomers {
  items: CustomerProjection[];
  total: number;
  limit: number;
  offset: number;
}
