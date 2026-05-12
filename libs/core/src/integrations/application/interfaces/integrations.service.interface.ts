/**
 * Integrations Service Interface
 *
 * Defines the contract for adapter resolution and capability-based adapter
 * lookup. Implemented by IntegrationsService to provide runtime adapter
 * resolution for connections and capabilities.
 *
 * @module libs/core/src/integrations/application/interfaces
 * @see {@link IntegrationsService} for the implementation
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import {
  AdapterMetadata,
  AdapterInstance,
} from '../../domain/types/adapter.types';

export interface IIntegrationsService {
  /**
   * Get adapter for a connection
   *
   * Resolves connection, determines adapterKey (explicit or derived from platformType),
   * loads adapter from registry, and returns connection, adapter, and metadata.
   *
   * @param connectionId - The connection identifier (UUID)
   * @returns Object containing connection, adapter instance, and metadata
   * @throws ConnectionNotFoundException if connection not found
   * @throws ConnectionDisabledException if connection is disabled
   * @throws AdapterNotFoundException if adapter key not found in registry
   */
  getAdapter(connectionId: string): Promise<{
    connection: Connection;
    adapter: AdapterInstance;
    metadata: AdapterMetadata;
  }>;

  /**
   * Get capability adapter for a connection
   *
   * Resolves adapter for connection and validates that it supports the requested
   * capability. Returns typed adapter instance.
   *
   * @param connectionId - The connection identifier (UUID)
   * @param capability - The capability to resolve (e.g., 'ProductMaster')
   * @returns Typed adapter instance implementing the capability port
   * @throws ConnectionNotFoundException if connection not found
   * @throws ConnectionDisabledException if connection is disabled
   * @throws AdapterNotFoundException if adapter key not found in registry
   * @throws CapabilityNotSupportedException if adapter doesn't support the capability
   */
  getCapabilityAdapter<T>(connectionId: string, capability: string): Promise<T>;

  /**
   * List all adapters supporting a capability
   *
   * Required for multiple adapters per capability (e.g., multiple OrderProcessorManagers:
   * PrestaShop + Allegro). Returns all active connections whose adapters support
   * the requested capability.
   *
   * @param filters - Filter criteria (capability required, platformType optional)
   * @returns Array of objects containing connectionId, connection, adapter, and metadata
   */
  /**
   * Resolve adapter metadata by platformType and optional explicit adapterKey.
   *
   * Used during connection creation (before the connection exists) to determine
   * defaults for fields like `enabledCapabilities`. Mirrors the adapterKey
   * derivation used by getAdapter() but does not require a persisted connection.
   *
   * @throws AdapterNotFoundException if no adapter matches
   */
  resolveAdapterMetadata(params: {
    platformType: string;
    adapterKey?: string;
  }): Promise<AdapterMetadata>;

  listCapabilityAdapters<T>(filters: {
    capability: string;
    platformType?: string;
  }): Promise<
    Array<{
      connectionId: string;
      connection: Connection;
      adapter: T;
      metadata: AdapterMetadata;
    }>
  >;
}

