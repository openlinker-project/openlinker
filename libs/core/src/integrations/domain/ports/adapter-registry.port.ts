/**
 * Adapter Registry Port
 *
 * Defines the contract for adapter registry operations. Implemented by
 * AdapterRegistryService to provide adapter lookup and metadata retrieval
 * capabilities for the integrations service.
 *
 * @module libs/core/src/integrations/domain/ports
 * @see {@link AdapterRegistryService} for the implementation
 */
import { AdapterMetadata, AdapterInstance } from '../types/adapter.types';

export interface AdapterRegistryPort {
  /**
   * Get adapter instance by adapter key
   * @param adapterKey - The versioned adapter key (e.g., 'prestashop.webservice.v1')
   * @returns Adapter instance (placeholder/mock for MVP)
   */
  getAdapter(adapterKey: string): Promise<AdapterInstance>;

  /**
   * Get adapter metadata by adapter key
   * @param adapterKey - The versioned adapter key
   * @returns Adapter metadata or throws if not found
   */
  getAdapterMetadata(adapterKey: string): Promise<AdapterMetadata>;

  /**
   * List all registered adapters
   * @returns Array of all adapter metadata
   */
  listAdapters(): Promise<AdapterMetadata[]>;

  /**
   * Register an adapter's metadata at boot. Called by each integration
   * module's `onModuleInit`, mirroring `AdapterFactoryResolverService.registerFactory`.
   *
   * Sync (returns `void`) — deliberately mirrors the sister factory
   * resolver so contributors can reason about both registries the same
   * way at boot time. The read-side methods above stay async because
   * they may grow IO (DB-backed registry) in the future; registration
   * is in-process. (#570)
   *
   * @param metadata - Adapter metadata; `metadata.adapterKey` must be unique.
   *   When `metadata.isDefault === true`, also marks this adapter as the
   *   default for its `platformType` (resolution target for connections
   *   without an explicit `adapterKey`).
   * @throws DuplicateAdapterKeyException if `metadata.adapterKey` is already registered
   * @throws DuplicatePlatformDefaultException if a default already exists for this platformType
   */
  register(metadata: AdapterMetadata): void;

  /**
   * Resolve the default adapterKey for a platformType. Called by
   * `IntegrationsService` when a connection has no explicit `adapterKey`. (#571)
   *
   * @param platformType - Platform type identifier (e.g., 'prestashop', 'allegro')
   * @returns The adapterKey of the integration module that registered
   *   itself as `isDefault: true` for this platformType
   * @throws AdapterNotFoundException if no default is registered for the platformType
   */
  getDefaultAdapterKey(platformType: string): Promise<string>;
}






