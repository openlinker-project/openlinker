/**
 * Adapter Factory Port
 *
 * Defines the contract for creating adapter instances from connections.
 * Each adapter implementation provides a factory that implements this port.
 *
 * @module libs/core/src/integrations/domain/ports
 */
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CredentialsResolverPort } from './credentials-resolver.port';
import { Capability } from '../types/adapter.types';

/**
 * Adapter Factory Port
 *
 * Factory interface for creating adapter instances. Each adapter library
 * (e.g., PrestaShop, Allegro) provides a factory implementation.
 */
export interface AdapterFactoryPort {
  /**
   * Create adapter instance for a capability
   *
   * @param connection - Connection entity
   * @param capability - Capability to create adapter for
   * @param identifierMapping - Identifier mapping service
   * @param credentialsResolver - Credentials resolver service
   * @returns Adapter instance implementing the capability port
   */
  createCapabilityAdapter<T>(
    connection: Connection,
    capability: Capability,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<T>;
}



