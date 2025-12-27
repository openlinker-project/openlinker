/**
 * Adapter Registry Service
 *
 * In-memory static registry of adapters and their capabilities. Provides
 * adapter lookup and metadata retrieval for the integrations service.
 * In MVP, this uses a static in-memory registry. Future versions may
 * support dynamic registration or database-backed registry.
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 * @implements {AdapterRegistryPort}
 * @see {@link AdapterRegistryPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import { AdapterRegistryPort } from '../../domain/ports/adapter-registry.port';
import {
  AdapterMetadata,
  AdapterInstance,
  Capability,
} from '../../domain/types/adapter.types';
import { AdapterNotFoundException } from '../../domain/exceptions/adapter-not-found.exception';

@Injectable()
export class AdapterRegistryService implements AdapterRegistryPort {
  // Static in-memory registry (MVP approach)
  private readonly registry: Map<string, AdapterMetadata> = new Map(
    [
      {
        adapterKey: 'prestashop.webservice.v1',
        platformType: 'prestashop',
        supportedCapabilities: [
          'ProductMaster',
          'InventoryMaster',
          'OrderProcessorManager',
        ] as Capability[],
        displayName: 'PrestaShop WebService v1',
        version: '1.0.0',
      },
      {
        adapterKey: 'allegro.publicapi.v1',
        platformType: 'allegro',
        supportedCapabilities: ['Marketplace', 'OrderProcessorManager'] as Capability[],
        displayName: 'Allegro Public API v1',
        version: '1.0.0',
      },
    ].map((meta) => [meta.adapterKey, meta]),
  );

  async getAdapter(adapterKey: string): Promise<AdapterInstance> {
    const metadata = await this.getAdapterMetadata(adapterKey);
    // Return placeholder/mock instance for MVP
    return { adapterKey: metadata.adapterKey } as AdapterInstance;
  }

  async getAdapterMetadata(adapterKey: string): Promise<AdapterMetadata> {
    const metadata = this.registry.get(adapterKey);
    if (!metadata) {
      throw new AdapterNotFoundException(adapterKey);
    }
    return metadata;
  }

  async listAdapters(): Promise<AdapterMetadata[]> {
    return Array.from(this.registry.values());
  }
}

