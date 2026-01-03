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
}



