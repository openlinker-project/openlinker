/**
 * Integrations Service
 *
 * Implements adapter resolution and capability-based adapter lookup. Resolves
 * adapters for connections, validates capability support, and provides typed
 * adapter instances for use by application services.
 *
 * @module libs/core/src/integrations/application/services
 * @implements {IIntegrationsService}
 * @see {@link IIntegrationsService} for the interface
 * @see {@link ConnectionPort} for connection retrieval
 * @see {@link AdapterRegistryPort} for adapter registry
 */
import { Injectable } from '@nestjs/common';
import { IIntegrationsService } from '../interfaces/integrations.service.interface';
import { ConnectionPort } from '@openlinker/core/identifier-mapping/domain/ports/connection.port';
import { CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping/identifier-mapping.tokens';
import { Inject } from '@nestjs/common';
import {
  AdapterMetadata,
  AdapterInstance,
  Capability,
} from '@openlinker/core/integrations/domain/types/adapter.types';
import { AdapterRegistryPort } from '@openlinker/core/integrations/domain/ports/adapter-registry.port';
import {
  ADAPTER_REGISTRY_TOKEN,
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  CREDENTIALS_RESOLVER_TOKEN,
} from '@openlinker/core/integrations/integrations.tokens';
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import { ConnectionDisabledException } from '@openlinker/core/identifier-mapping/domain/exceptions/connection-disabled.exception';
import { AdapterNotFoundException } from '@openlinker/core/integrations/domain/exceptions/adapter-not-found.exception';
import { CapabilityNotSupportedException } from '@openlinker/core/integrations/domain/exceptions/capability-not-supported.exception';
import { AdapterFactoryResolverService } from '@openlinker/core/integrations/infrastructure/adapters/adapter-factory-resolver.service';
import { CredentialsResolverPort } from '@openlinker/core/integrations/domain/ports/credentials-resolver.port';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { IDENTIFIER_MAPPING_PORT_TOKEN } from '@openlinker/core/identifier-mapping/identifier-mapping.tokens';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class IntegrationsService implements IIntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(ADAPTER_REGISTRY_TOKEN)
    private readonly adapterRegistry: AdapterRegistryPort,
    @Inject(ADAPTER_FACTORY_RESOLVER_TOKEN)
    private readonly factoryResolver: AdapterFactoryResolverService,
    @Inject(IDENTIFIER_MAPPING_PORT_TOKEN)
    private readonly identifierMapping: IdentifierMappingPort,
    @Inject(CREDENTIALS_RESOLVER_TOKEN)
    private readonly credentialsResolver: CredentialsResolverPort,
  ) {}

  async getAdapter(connectionId: string): Promise<{
    connection: Connection;
    adapter: AdapterInstance;
    metadata: AdapterMetadata;
  }> {
    this.logger.debug(`Resolving adapter for connection: ${connectionId}`);

    // Resolve connection
    const connection = await this.connectionPort.get(connectionId);

    // Validate connection is not disabled
    if (connection.status === 'disabled') {
      this.logger.warn(`Attempted to resolve adapter for disabled connection: ${connectionId}`);
      throw new ConnectionDisabledException(connectionId);
    }

    // Determine adapterKey
    const adapterKey = connection.adapterKey ?? this.deriveAdapterKey(connection.platformType);
    this.logger.debug(
      `Resolved adapterKey: ${adapterKey}${connection.adapterKey ? ' (explicit)' : ` (derived from platformType: ${connection.platformType})`}`,
    );

    // Load adapter and metadata from registry
    const [adapter, metadata] = await Promise.all([
      this.adapterRegistry.getAdapter(adapterKey),
      this.adapterRegistry.getAdapterMetadata(adapterKey),
    ]);

    this.logger.log(
      `Adapter resolved: ${adapterKey} for connection ${connectionId} (capabilities: ${metadata.supportedCapabilities.join(', ')})`,
    );

    return {
      connection,
      adapter,
      metadata,
    };
  }

  async getCapabilityAdapter<T>(
    connectionId: string,
    capability: Capability,
  ): Promise<T> {
    this.logger.debug(`Resolving ${capability} adapter for connection: ${connectionId}`);

    const { connection, metadata } = await this.getAdapter(connectionId);

    // Validate capability support
    if (!metadata.supportedCapabilities.includes(capability)) {
      this.logger.warn(
        `Capability ${capability} not supported by adapter ${metadata.adapterKey} (supported: ${metadata.supportedCapabilities.join(', ')})`,
      );
      throw new CapabilityNotSupportedException(metadata.adapterKey, capability);
    }

    // Try to create adapter using factory resolver
    // If factory is not registered, fall back to placeholder from registry
    if (this.factoryResolver.hasFactory(metadata.adapterKey)) {
      this.logger.debug(`Using factory to create ${capability} adapter for ${metadata.adapterKey}`);
      try {
        return await this.factoryResolver.createCapabilityAdapter<T>(
          metadata.adapterKey,
          connection,
          capability,
          this.identifierMapping,
          this.credentialsResolver,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to create adapter using factory: ${(error as Error).message}. Falling back to registry placeholder.`,
        );
        // Fall through to registry placeholder
      }
    }

    // Fallback: return placeholder from registry (for adapters without factories)
    const { adapter } = await this.getAdapter(connectionId);
    this.logger.log(
      `Capability adapter resolved: ${capability} for connection ${connectionId} (adapter: ${metadata.adapterKey}, using placeholder)`,
    );

    return adapter as T;
  }

  async listCapabilityAdapters<T>(filters: {
    capability: Capability;
    platformType?: string;
  }): Promise<
    Array<{
      connectionId: string;
      connection: Connection;
      adapter: T;
      metadata: AdapterMetadata;
    }>
  > {
    this.logger.debug(
      `Listing ${filters.capability} adapters${filters.platformType ? ` (platform: ${filters.platformType})` : ''}`,
    );

    // List all active connections (filter by platformType if provided)
    const connectionFilters = {
      status: 'active' as const,
      ...(filters.platformType && { platformType: filters.platformType }),
    };
    const connections = await this.connectionPort.list(connectionFilters);

    this.logger.debug(`Found ${connections.length} active connection(s) to check`);

    const results: Array<{
      connectionId: string;
      connection: Connection;
      adapter: T;
      metadata: AdapterMetadata;
    }> = [];

    // For each connection, resolve adapter and metadata
    for (const connection of connections) {
      try {
        const adapterKey =
          connection.adapterKey ?? this.deriveAdapterKey(connection.platformType);

        const metadata = await this.adapterRegistry.getAdapterMetadata(adapterKey);

        // Filter to only connections whose adapter supports the requested capability
        if (metadata.supportedCapabilities.includes(filters.capability)) {
          const adapter = await this.adapterRegistry.getAdapter(adapterKey);
          results.push({
            connectionId: connection.id,
            connection,
            adapter: adapter as T,
            metadata,
          });
          this.logger.debug(
            `Connection ${connection.id} supports ${filters.capability} (adapter: ${adapterKey})`,
          );
        } else {
          this.logger.debug(
            `Connection ${connection.id} does not support ${filters.capability} (adapter: ${adapterKey}, supported: ${metadata.supportedCapabilities.join(', ')})`,
          );
        }
      } catch (error) {
        // Log and skip connections with invalid adapter keys
        if (error instanceof AdapterNotFoundException) {
          this.logger.warn(
            `Skipping connection ${connection.id}: ${error.message}`,
          );
          continue;
        }
        // Re-throw unexpected errors
        throw error;
      }
    }

    this.logger.log(
      `Found ${results.length} adapter(s) supporting ${filters.capability}${filters.platformType ? ` for platform ${filters.platformType}` : ''}`,
    );

    return results;
  }

  /**
   * Derives adapterKey from platformType if not explicitly set.
   *
   * Hardcoded for MVP, but extracted to enable easy configuration later.
   * Future: Can be replaced with:
   * - Configuration service injection
   * - Database lookup
   * - Environment variable mapping
   *
   * @param platformType - The platform type (e.g., 'prestashop', 'allegro')
   * @returns The default adapter key for the platform type
   * @throws AdapterNotFoundException if no default adapter key found
   */
  private deriveAdapterKey(platformType: string): string {
    const mapping: Record<string, string> = {
      prestashop: 'prestashop.webservice.v1',
      allegro: 'allegro.publicapi.v1',
    };

    const adapterKey = mapping[platformType];
    if (!adapterKey) {
      throw new AdapterNotFoundException(
        `No default adapterKey found for platformType: ${platformType}`,
      );
    }

    return adapterKey;
  }
}

