/**
 * Adapter Factory Port
 *
 * Defines the contract for creating adapter instances from connections.
 * Each adapter implementation provides a factory that implements this port.
 *
 * @module libs/core/src/integrations/domain/ports
 */
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from './credentials-resolver.port';

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
    capability: string,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort
  ): Promise<T>;
}
