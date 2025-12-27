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
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import {
  AdapterMetadata,
  AdapterInstance,
  Capability,
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
  getCapabilityAdapter<T>(connectionId: string, capability: Capability): Promise<T>;

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
  listCapabilityAdapters<T>(filters: {
    capability: Capability;
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

