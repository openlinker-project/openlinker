/**
 * Allegro Adapter Factory Interface
 *
 * Defines the contract for creating Allegro adapter instances from Connection
 * entities. The factory validates configuration, resolves credentials, and creates
 * adapter instances with all dependencies injected.
 *
 * @module libs/integrations/allegro/src/application/interfaces
 */
import { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CredentialsResolverPort } from '@openlinker/core/integrations';
// eslint-disable-next-line no-restricted-imports
import { AllegroMarketplaceAdapter } from '../../infrastructure/adapters/allegro-marketplace.adapter';

/**
 * Allegro adapter instances
 *
 * Container for all capability adapters created from a Connection.
 * For MVP, only Marketplace adapter is implemented.
 */
export interface AllegroAdapters {
  marketplace: AllegroMarketplaceAdapter;
}

/**
 * Allegro Adapter Factory Interface
 *
 * Factory for creating Allegro adapter instances from Connection entities.
 */
export interface IAllegroAdapterFactory {
  /**
   * Create all Allegro adapters for a connection
   *
   * @param connection - Connection entity with Allegro config
   * @param identifierMapping - Identifier mapping service for ID translation
   * @param credentialsResolver - Credentials resolver for OAuth token retrieval
   * @returns Container with all Allegro adapters
   */
  createAdapters(
    connection: Connection,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<AllegroAdapters>;
}


