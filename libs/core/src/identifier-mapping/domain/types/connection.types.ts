/**
 * Connection Types
 *
 * Type definitions for Connection entity. Defines platform types, connection
 * status values, and connection configuration structure. Used across the
 * identifier mapping domain to represent integration instances.
 *
 * @module libs/core/src/identifier-mapping/domain/types
 */

/**
 * Platform type identifier (e.g., 'prestashop', 'allegro', 'shopify')
 */
export type PlatformType = string;

/**
 * Connection status values
 */
export type ConnectionStatus = 'active' | 'disabled' | 'error';

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

