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
 *
 * `needs_reauth` is set automatically when a job dies from a terminal
 * credential rejection (e.g. Allegro `invalid_grant` on token refresh, #819).
 * It is distinct from `error` (which covers other failure modes) so the UI can
 * surface a precise "re-authentication required" affordance, and — like every
 * non-`active` status — the scheduler's `status: 'active'` filter stops
 * enqueuing jobs against it. A successful re-auth flips it back to `active`.
 */
export const ConnectionStatusValues = ['active', 'disabled', 'error', 'needs_reauth'] as const;

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
  /**
   * Invoicing trigger configuration (OL #1120). Non-breaking documentation
   * shape over the open index signature — the value is round-tripped verbatim
   * by `ConnectionRepository`. `triggerModel` is read at transition time by
   * `AutoIssueTriggerService` and coerced via `parseTriggerModel` (a missing or
   * unrecognized value defaults to `manual`). Typed as `string` here to keep the
   * identifier-mapping context decoupled from the invoicing enum.
   */
  invoicing?: {
    triggerModel?: string;
  };
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
  /**
   * Capabilities this connection should fulfil. Subset of the resolved adapter's
   * supportedCapabilities. When omitted at create time, ConnectionService defaults
   * this to the adapter's full supported set (behavior-preserving).
   */
  enabledCapabilities?: string[];
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
  /**
   * `adapterKey` is immutable post-create. Passing a value different from the
   * persisted one must cause ConnectionService.update to throw. Kept optional
   * here so existing callers that pass the unchanged value still type-check.
   */
  adapterKey?: string;
  enabledCapabilities?: string[];
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



