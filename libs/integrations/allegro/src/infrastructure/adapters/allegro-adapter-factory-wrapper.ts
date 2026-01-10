/**
 * Allegro Adapter Factory Wrapper
 *
 * Wraps AllegroAdapterFactory to implement AdapterFactoryPort interface.
 * This allows the Allegro factory to be registered with AdapterFactoryResolverService.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 * @implements {AdapterFactoryPort}
 */
import { AdapterFactoryPort, CredentialsResolverPort, Capability } from '@openlinker/core/integrations';
import { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { AllegroAdapterFactory } from '../../application/allegro-adapter.factory';
// Adapters are created by factory, no need to import here

/**
 * Allegro Adapter Factory Wrapper
 *
 * Implements AdapterFactoryPort to integrate with AdapterFactoryResolverService.
 */
export class AllegroAdapterFactoryWrapper implements AdapterFactoryPort {
  private readonly factory = new AllegroAdapterFactory();

  async createCapabilityAdapter<T>(
    connection: Connection,
    capability: Capability,
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
      case 'Marketplace':
        return adapters.marketplace as unknown as T;
      default:
        throw new Error(
          `Allegro adapter does not support capability: ${capability}. ` +
            `Supported capabilities: Marketplace`,
        );
    }
  }
}



