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
import { ConnectionPort, CONNECTION_PORT_TOKEN, Connection, ConnectionDisabledException, IdentifierMappingPort, IDENTIFIER_MAPPING_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import { Inject } from '@nestjs/common';
import {
  AdapterMetadata,
  AdapterInstance,
} from '../../domain/types/adapter.types';
import { AdapterRegistryPort } from '../../domain/ports/adapter-registry.port';
import {
  ADAPTER_REGISTRY_TOKEN,
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  CREDENTIALS_RESOLVER_TOKEN,
} from '../../integrations.tokens';
import { AdapterNotFoundException } from '../../domain/exceptions/adapter-not-found.exception';
import { CapabilityNotSupportedException } from '../../domain/exceptions/capability-not-supported.exception';
import { CapabilityNotEnabledException } from '../../domain/exceptions/capability-not-enabled.exception';
import { AdapterFactoryResolverService } from '../../infrastructure/adapters/adapter-factory-resolver.service';
import { CredentialsResolverPort } from '../../domain/ports/credentials-resolver.port';
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
    const adapterKey =
      connection.adapterKey ?? (await this.adapterRegistry.getDefaultAdapterKey(connection.platformType));
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
    capability: string,
  ): Promise<T> {
    this.logger.debug(`Resolving ${capability} adapter for connection: ${connectionId}`);

    const { connection, metadata } = await this.getAdapter(connectionId);

    // Validate capability support (adapter level)
    if (!metadata.supportedCapabilities.includes(capability)) {
      this.logger.warn(
        `Capability ${capability} not supported by adapter ${metadata.adapterKey} (supported: ${metadata.supportedCapabilities.join(', ')})`,
      );
      throw new CapabilityNotSupportedException(metadata.adapterKey, capability);
    }

    // Validate capability is enabled on this specific connection
    if (!connection.enabledCapabilities.includes(capability)) {
      this.logger.warn(
        `Capability ${capability} disabled on connection ${connectionId} (enabled: ${connection.enabledCapabilities.join(', ') || '<none>'})`,
      );
      throw new CapabilityNotEnabledException(connectionId, metadata.adapterKey, capability);
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
        // Configuration errors should fail fast (don't fall back to placeholder)
        // Only AdapterNotFoundException (factory not found) should fall back
        if (error instanceof AdapterNotFoundException) {
          this.logger.warn(
            `Factory not found for adapter ${metadata.adapterKey}: ${(error as Error).message}. Falling back to registry placeholder.`,
          );
          // Fall through to registry placeholder
        } else {
          // Configuration errors, credential errors, etc. - fail fast
          this.logger.error(
            `Failed to create adapter using factory: ${(error as Error).message}. This is a configuration error and cannot fall back to placeholder.`,
          );
          throw error;
        }
      }
    }

    // Fallback: return placeholder from registry (for adapters without factories)
    const { adapter } = await this.getAdapter(connectionId);
    this.logger.log(
      `Capability adapter resolved: ${capability} for connection ${connectionId} (adapter: ${metadata.adapterKey}, using placeholder)`,
    );

    return adapter as T;
  }

  async resolveAdapterMetadata(params: {
    platformType: string;
    adapterKey?: string;
  }): Promise<AdapterMetadata> {
    const adapterKey =
      params.adapterKey ?? (await this.adapterRegistry.getDefaultAdapterKey(params.platformType));
    return this.adapterRegistry.getAdapterMetadata(adapterKey);
  }

  async listCapabilityAdapters<T>(filters: {
    capability: string;
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
          connection.adapterKey ??
          (await this.adapterRegistry.getDefaultAdapterKey(connection.platformType));

        const metadata = await this.adapterRegistry.getAdapterMetadata(adapterKey);

        // Filter to only connections whose adapter supports AND whose operator
        // has enabled the requested capability on this connection.
        const adapterSupports = metadata.supportedCapabilities.includes(filters.capability);
        const connectionEnabled = connection.enabledCapabilities.includes(filters.capability);
        if (adapterSupports && connectionEnabled) {
          // Try to create adapter using factory resolver (mirrors getCapabilityAdapter logic)
          // If factory is not registered, fall back to placeholder from registry
          let adapter: T | null = null;
          if (this.factoryResolver.hasFactory(adapterKey)) {
            this.logger.debug(
              `Using factory to create ${filters.capability} adapter for ${adapterKey} (connection: ${connection.id})`,
            );
            try {
              adapter = await this.factoryResolver.createCapabilityAdapter<T>(
                adapterKey,
                connection,
                filters.capability,
                this.identifierMapping,
                this.credentialsResolver,
              );
            } catch (error) {
              // Configuration errors should fail fast (don't fall back to placeholder)
              // Only AdapterNotFoundException (factory not found) should fall back
              if (error instanceof AdapterNotFoundException) {
                this.logger.warn(
                  `Factory not found for adapter ${adapterKey} (connection: ${connection.id}): ${(error as Error).message}. Falling back to registry placeholder.`,
                );
                // Fall through to registry placeholder
                const registryAdapter = await this.adapterRegistry.getAdapter(adapterKey);
                adapter = registryAdapter as T;
              } else {
                // Configuration errors, credential errors, etc. - skip this connection
                this.logger.error(
                  `Failed to create adapter using factory for connection ${connection.id}: ${(error as Error).message}. This is a configuration error, skipping connection.`,
                );
                // Skip this connection (don't add to results)
                adapter = null;
              }
            }
          } else {
            // Fallback: return placeholder from registry (for adapters without factories)
            const registryAdapter = await this.adapterRegistry.getAdapter(adapterKey);
            adapter = registryAdapter as T;
          }

          // Only add to results if adapter was successfully created
          if (adapter !== null) {
            results.push({
              connectionId: connection.id,
              connection,
              adapter,
              metadata,
            });
            this.logger.debug(
              `Connection ${connection.id} supports ${filters.capability} (adapter: ${adapterKey})`,
            );
          }
        } else if (!adapterSupports) {
          this.logger.debug(
            `Connection ${connection.id} does not support ${filters.capability} (adapter: ${adapterKey}, supported: ${metadata.supportedCapabilities.join(', ')})`,
          );
        } else {
          this.logger.debug(
            `Connection ${connection.id} has ${filters.capability} disabled (adapter supports it; enabled: ${connection.enabledCapabilities.join(', ') || '<none>'})`,
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

}

