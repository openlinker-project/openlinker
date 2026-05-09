/**
 * Allegro Adapter Factory Wrapper
 *
 * Wraps AllegroAdapterFactory to implement AdapterFactoryPort interface.
 * This allows the Allegro factory to be registered with AdapterFactoryResolverService.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 * @implements {AdapterFactoryPort}
 */
import { AdapterFactoryPort, CredentialsResolverPort } from '@openlinker/core/integrations';
import { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CustomerIdentityResolverPort } from '@openlinker/core/customers';
import type { CachePort } from '@openlinker/shared';
import { AllegroAdapterFactory } from '../../application/allegro-adapter.factory';
import { AllegroTokenRefreshService } from '../token-refresh/allegro-token-refresh.service';
import { AllegroQuantityCommandRepositoryPort } from '../../domain/ports/allegro-quantity-command-repository.port';
import { QuantityPollConfig } from './allegro-offer-manager.adapter';
// Adapters are created by factory, no need to import here

/**
 * Allegro Adapter Factory Wrapper
 *
 * Implements AdapterFactoryPort to integrate with AdapterFactoryResolverService.
 */
export class AllegroAdapterFactoryWrapper implements AdapterFactoryPort {
  private readonly factory: AllegroAdapterFactory;

  constructor(
    private readonly customerIdentityResolver?: CustomerIdentityResolverPort,
    private readonly tokenRefreshService?: AllegroTokenRefreshService,
    private readonly commandRepository?: AllegroQuantityCommandRepositoryPort,
    private readonly quantityPollConfig?: Partial<QuantityPollConfig>,
    /** Distributed cache for category parameters (#410). */
    private readonly cache?: CachePort,
    /** TTL override (seconds) for the category parameters cache. Defaults to 24h in the adapter. */
    private readonly catParamsTtlSec?: number,
  ) {
    this.factory = new AllegroAdapterFactory(
      this.customerIdentityResolver,
      this.tokenRefreshService,
      this.commandRepository,
      this.quantityPollConfig,
      this.cache,
      this.catParamsTtlSec,
    );
  }

  async createCapabilityAdapter<T>(
    connection: Connection,
    capability: string,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<T> {
    // Create all adapters
    const adapters = await this.factory.createAdapters(
      connection,
      identifierMapping,
      credentialsResolver,
    );

    // Return the requested capability adapter
    switch (capability) {
      case 'OfferManager':
        return adapters.offerManager as unknown as T;
      case 'OrderSource':
        return adapters.orderSource as unknown as T;
      default:
        throw new Error(
          `Allegro adapter does not support capability: ${capability}. ` +
            `Supported capabilities: OfferManager, OrderSource`,
        );
    }
  }
}



