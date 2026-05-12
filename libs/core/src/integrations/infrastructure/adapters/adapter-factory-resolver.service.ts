/**
 * Adapter Factory Resolver Service
 *
 * Resolves adapter factories by adapterKey and creates adapter instances.
 * Maps adapterKey to factory implementations (e.g., 'prestashop.webservice.v1' → PrestashopAdapterFactory).
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 */
import { Injectable } from '@nestjs/common';
import { AdapterFactoryPort } from '../../domain/ports/adapter-factory.port';
import { Connection } from '@openlinker/core/identifier-mapping';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CredentialsResolverPort } from '../../domain/ports/credentials-resolver.port';
import { AdapterNotFoundException } from '../../domain/exceptions/adapter-not-found.exception';
import { DuplicateAdapterKeyException } from '../../domain/exceptions/duplicate-adapter-key.exception';
import { Logger } from '@openlinker/shared/logging';

/**
 * Adapter Factory Resolver Service
 *
 * Resolves and instantiates adapter factories for connections.
 */
@Injectable()
export class AdapterFactoryResolverService {
  private readonly logger = new Logger(AdapterFactoryResolverService.name);
  private readonly factories: Map<string, AdapterFactoryPort> = new Map();

  /**
   * Register an adapter factory
   *
   * Throws `DuplicateAdapterKeyException` on a second registration for the
   * same adapterKey — fail-loud at boot rather than silently overwrite.
   * Mirrors `AdapterRegistryService.register()` (#570) so duplicate-key
   * semantics are consistent across both registries.
   *
   * @param adapterKey - Adapter key (e.g., 'prestashop.webservice.v1')
   * @param factory - Factory implementation
   * @throws DuplicateAdapterKeyException if `adapterKey` is already registered
   */
  registerFactory(adapterKey: string, factory: AdapterFactoryPort): void {
    if (this.factories.has(adapterKey)) {
      throw new DuplicateAdapterKeyException(adapterKey);
    }
    this.logger.debug(`Registering adapter factory: ${adapterKey}`);
    this.factories.set(adapterKey, factory);
  }

  /**
   * Resolve and create adapter instance for a capability
   *
   * @param adapterKey - Adapter key
   * @param connection - Connection entity
   * @param capability - Capability to create adapter for
   * @param identifierMapping - Identifier mapping service
   * @param credentialsResolver - Credentials resolver service
   * @returns Adapter instance
   * @throws AdapterNotFoundException if factory not found
   */
  async createCapabilityAdapter<T>(
    adapterKey: string,
    connection: Connection,
    capability: string,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<T> {
    const factory = this.factories.get(adapterKey);
    if (!factory) {
      throw new AdapterNotFoundException(
        `No factory registered for adapterKey: ${adapterKey}. ` +
          `Available factories: ${Array.from(this.factories.keys()).join(', ')}`,
      );
    }

    this.logger.debug(`Creating ${capability} adapter for connection ${connection.id} using factory: ${adapterKey}`);

    return factory.createCapabilityAdapter<T>(
      connection,
      capability,
      identifierMapping,
      credentialsResolver,
    );
  }

  /**
   * Check if factory is registered for adapterKey
   *
   * @param adapterKey - Adapter key
   * @returns True if factory is registered
   */
  hasFactory(adapterKey: string): boolean {
    return this.factories.has(adapterKey);
  }
}






