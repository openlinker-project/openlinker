/**
 * Adapter Types
 *
 * Type definitions for adapter registry and capability system. Defines the
 * well-known core capability set, adapter-metadata structure, and adapter
 * instance types. Used by the adapter registry and integrations service for
 * runtime adapter resolution.
 *
 * @module libs/core/src/integrations/domain/types
 */

/**
 * Well-known core capabilities — the documented set OpenLinker ships with.
 *
 * Plugin adapters can register additional capability names beyond this set
 * (#576). The runtime gate at `IntegrationsService.getCapabilityAdapter`
 * validates the requested capability against
 * `AdapterMetadata.supportedCapabilities`, which is the source of truth for
 * "is this capability supported?", regardless of whether the name appears
 * in `CoreCapabilityValues`.
 */
export const CoreCapabilityValues = [
  'ProductMaster',
  'InventoryMaster',
  'OrderProcessorManager',
  'OrderSource',
  'OfferManager',
] as const;

/**
 * Closed type for the well-known core capabilities.
 *
 * Use `CoreCapability` where exhaustiveness or strict validation matters
 * (HTTP DTOs, FE dropdowns). At extension boundaries (adapter metadata,
 * integrations service, exception constructors) the parameter / field
 * type is bare `string` with a JSDoc pointer back to {@link CoreCapability}.
 * The documentation lives in JSDoc; the type system reflects what the
 * runtime actually accepts.
 */
export type CoreCapability = (typeof CoreCapabilityValues)[number];

/**
 * Adapter metadata.
 *
 * Describes an adapter's capabilities and metadata. Used by AdapterRegistry
 * to resolve adapters at runtime. Each adapter must declare at least one
 * supported capability.
 *
 * `supportedCapabilities` is `string[]` so plugin
 * adapters can register capability names beyond the well-known core set
 * (#576). The runtime gate at `IntegrationsService.getCapabilityAdapter`
 * validates the requested capability against this array.
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
   * Open string set: well-known values come from {@link CoreCapabilityValues}
   * / {@link CoreCapability}; plugin adapters can register additional names
   * (#576). The runtime gate at `IntegrationsService.getCapabilityAdapter`
   * is the source of truth for "is this capability supported".
   */
  supportedCapabilities: string[];

  /**
   * Optional human-readable display name
   */
  displayName?: string;

  /**
   * Optional adapter version
   */
  version?: string;

  /**
   * When true, this adapter is the default for its platformType — i.e.
   * `IntegrationsService` resolves an unspecified `connection.adapterKey`
   * to this adapter's key. At most one default per platformType is
   * permitted; the registry rejects a second default registration with
   * `DuplicatePlatformDefaultException`. (#571)
   */
  isDefault?: boolean;
}

