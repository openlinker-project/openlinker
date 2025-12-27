/**
 * Connection Types
 *
 * Type definitions for Connection entity. Defines platform types, connection
 * status values, connection configuration structure, and CRUD operation types.
 * Used across the identifier mapping domain to represent integration instances.
 *
 * @module libs/core/src/identifier-mapping/domain/types
 */

/**
 * Platform type identifier (e.g., 'prestashop', 'allegro', 'shopify')
 */
export type PlatformType = string;

/**
 * Connection status values
 *
 * Runtime array of all valid connection status values. Used for validation,
 * Swagger documentation, and UI dropdowns. Follows OpenLinker engineering
 * standards: `as const` + derived union type pattern.
 */
export const ConnectionStatusValues = ['active', 'disabled', 'error'] as const;

/**
 * Connection status type
 *
 * Derived union type from ConnectionStatusValues. Provides type safety
 * without runtime overhead.
 */
export type ConnectionStatus = (typeof ConnectionStatusValues)[number];

/**
 * Connection configuration
 *
 * Platform-specific configuration stored as JSONB. Contains platform-specific
 * settings such as baseUrl, shopId, accountId, etc. Secrets should not be
 * stored here; use credentialsRef instead.
 */
export interface ConnectionConfig {
  [key: string]: unknown;
}

/**
 * Connection creation payload
 *
 * Used when creating a new connection. All fields except adapterKey are required.
 * If adapterKey is not provided, it will be derived from platformType in the
 * IntegrationsService.
 */
export interface ConnectionCreate {
  name: string;
  platformType: PlatformType;
  config: ConnectionConfig;
  credentialsRef: string;
  adapterKey?: string;
}

/**
 * Connection update payload
 *
 * Partial update payload for modifying an existing connection. Only provided
 * fields will be updated.
 */
export interface ConnectionUpdate {
  name?: string;
  status?: ConnectionStatus;
  config?: ConnectionConfig;
  adapterKey?: string;
}

/**
 * Connection filter criteria
 *
 * Used for filtering connections when listing. All fields are optional.
 */
export interface ConnectionFilters {
  platformType?: PlatformType;
  status?: ConnectionStatus;
}



