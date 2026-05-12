/**
 * Adapter Registry Service
 *
 * In-memory registry of adapters and their metadata. Populated at boot by
 * each `*IntegrationModule.onModuleInit()` calling `register(...)`, replacing
 * the previous static inline literal that lived in this file (#570). Mirrors
 * the sister `AdapterFactoryResolverService.registerFactory` pattern — both
 * registries are populated by the integration modules they describe, and
 * `libs/core` no longer carries platform-specific knowledge of which
 * adapters exist. Also tracks the per-platform default adapterKey, replacing
 * the hardcoded `IntegrationsService.deriveAdapterKey` map (#571).
 *
 * Future versions may swap the in-memory map for DB-backed persistence; the
 * port keeps `getAdapter` / `getAdapterMetadata` / `listAdapters` /
 * `getDefaultAdapterKey` async to leave that door open.
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 * @implements {AdapterRegistryPort}
 * @see {@link AdapterRegistryPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { AdapterRegistryPort } from '../../domain/ports/adapter-registry.port';
import { AdapterMetadata } from '../../domain/types/adapter.types';
import { AdapterNotFoundException } from '../../domain/exceptions/adapter-not-found.exception';
import { DuplicateAdapterKeyException } from '../../domain/exceptions/duplicate-adapter-key.exception';
import { DuplicatePlatformDefaultException } from '../../domain/exceptions/duplicate-platform-default.exception';

@Injectable()
export class AdapterRegistryService implements AdapterRegistryPort {
  private readonly logger = new Logger(AdapterRegistryService.name);
  private readonly registry: Map<string, AdapterMetadata> = new Map();
  private readonly defaultsByPlatform: Map<string, string> = new Map();

  register(metadata: AdapterMetadata): void {
    if (this.registry.has(metadata.adapterKey)) {
      throw new DuplicateAdapterKeyException(metadata.adapterKey);
    }
    if (metadata.isDefault === true) {
      const existing = this.defaultsByPlatform.get(metadata.platformType);
      if (existing) {
        throw new DuplicatePlatformDefaultException(
          metadata.platformType,
          existing,
          metadata.adapterKey,
        );
      }
      this.defaultsByPlatform.set(metadata.platformType, metadata.adapterKey);
    }
    this.registry.set(metadata.adapterKey, metadata);
    this.logger.log(
      `Registered adapter: ${metadata.adapterKey}` +
        (metadata.isDefault === true ? ` (default for ${metadata.platformType})` : ''),
    );
  }

  getAdapterMetadata(adapterKey: string): Promise<AdapterMetadata> {
    const metadata = this.registry.get(adapterKey);
    if (!metadata) {
      return Promise.reject(new AdapterNotFoundException(adapterKey));
    }
    return Promise.resolve(metadata);
  }

  listAdapters(): Promise<AdapterMetadata[]> {
    return Promise.resolve(Array.from(this.registry.values()));
  }

  // Mirrors `getAdapterMetadata` shape — returns a Promise without `async`
  // so eslint's `require-await` doesn't flag a sync body. The port keeps
  // the signature async-shaped to leave the door open for a future
  // DB-backed registry without changing every call site.
  getDefaultAdapterKey(platformType: string): Promise<string> {
    const adapterKey = this.defaultsByPlatform.get(platformType);
    if (!adapterKey) {
      return Promise.reject(
        new AdapterNotFoundException(
          `No default adapter registered for platformType: ${platformType}. ` +
            `Available platforms: [${Array.from(this.defaultsByPlatform.keys()).join(', ')}]`,
        ),
      );
    }
    return Promise.resolve(adapterKey);
  }
}
