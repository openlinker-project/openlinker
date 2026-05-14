/**
 * Allegro Adapter Factory Interface
 *
 * Defines the contract for creating Allegro adapter instances from Connection
 * entities. The factory validates configuration, resolves credentials, and creates
 * adapter instances with all dependencies injected.
 *
 * @module libs/integrations/allegro/src/application/interfaces
 */
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
// eslint-disable-next-line no-restricted-imports -- local relative import is intentional here; barrel path would create a runtime cycle
import type { AllegroOfferManagerAdapter } from '../../infrastructure/adapters/allegro-offer-manager.adapter';
// eslint-disable-next-line no-restricted-imports -- local relative import is intentional here; barrel path would create a runtime cycle
import type { AllegroOrderSourceAdapter } from '../../infrastructure/adapters/allegro-order-source.adapter';

/**
 * Allegro adapter instances
 *
 * Container for all capability adapters created from a Connection.
 * Both adapters share the same Allegro HTTP client + identifier-mapping
 * instance constructed once per `createAdapters()` call.
 */
export interface AllegroAdapters {
  offerManager: AllegroOfferManagerAdapter;
  orderSource: AllegroOrderSourceAdapter;
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
    credentialsResolver: CredentialsResolverPort
  ): Promise<AllegroAdapters>;
}
