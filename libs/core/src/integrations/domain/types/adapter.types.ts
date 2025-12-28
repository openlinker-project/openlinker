/**
 * Adapter Types
 *
 * Type definitions for adapter registry and capability system. Defines capability
 * types, adapter metadata structure, and adapter instance types. Used by the
 * adapter registry and integrations service for runtime adapter resolution.
 *
 * @module libs/core/src/integrations/domain/types
 */

/**
 * Capability values
 *
 * Runtime array of all valid capability values. Used for validation,
 * Swagger documentation, and UI dropdowns. Follows OpenLinker engineering
 * standards: `as const` + derived union type pattern.
 */
export const CapabilityValues = [
  'ProductMaster',
  'InventoryMaster',
  'OrderProcessorManager',
  'Marketplace',
] as const;

/**
 * Capability type
 *
 * Represents business capabilities that adapters can support.
 * Matches capability ports in architecture. Derived from CapabilityValues
 * using the union-from-const pattern per engineering standards.
 */
export type Capability = (typeof CapabilityValues)[number];

/**
 * Adapter metadata
 *
 * Describes an adapter's capabilities and metadata. Used by AdapterRegistry
 * to resolve adapters at runtime. Each adapter must declare at least one
 * supported capability.
 */
export interface AdapterMetadata {
  /**
   * Versioned adapter key (e.g., 'prestashop.webservice.v1', 'allegro.publicapi.v1')
   */
  adapterKey: string;

  /**
   * Platform type identifier (e.g., 'prestashop', 'allegro')
   */
  platformType: string;

  /**
   * Array of capabilities supported by this adapter. Must be non-empty.
   */
  supportedCapabilities: Capability[];

  /**
   * Optional human-readable display name
   */
  displayName?: string;

  /**
   * Optional adapter version
   */
  version?: string;
}

/**
 * Adapter instance
 *
 * Placeholder type for adapter instances. In MVP, these are mock/placeholder
 * instances. Full adapter implementations are separate epics.
 */
export type AdapterInstance = unknown;

