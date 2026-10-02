/**
 * Shoper Adapter Factory
 *
 * Per-connection factory for Shoper capability adapters. Resolves the
 * connection's `baseUrl` and Bearer token, builds ONE `ShoperHttpClient` over
 * the connection-bound transport, and constructs the capability adapters on
 * top of it. Credentials are resolved here, per call - never in a constructor
 * and never cached across connections.
 *
 * `getCapabilityAdapter` builds a fresh adapter bag on every call and memoises
 * nothing, so the shop-context request (`application-config`) would be repeated
 * once per resolution - one extra request per product job against a shop whose
 * request ceiling is unknown. The host cache, when wired, carries it between
 * resolutions for a few minutes (see `ShoperShopContextProvider`).
 *
 * @module libs/integrations/shoper/src/application
 */
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { CachePort } from '@openlinker/shared';
import type { FetchLike } from '@openlinker/shared/http';

import { ShoperConfigException } from '../domain/exceptions/shoper-config.exception';
import { parseShoperBaseUrl } from '../domain/policies/shoper-base-url.policy';
import type { ShoperCredentials } from '../domain/types/shoper-credentials.types';
import { ShoperOrderProcessorAdapter } from '../infrastructure/adapters/order-processor/shoper-order-processor.adapter';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import { ShoperOrderOptionsProvider } from '../infrastructure/shop-context/shoper-order-options.provider';
import type { ShoperCustomerProvisioner } from '../infrastructure/provisioners/shoper-customer.provisioner';
import { ShoperInventoryMasterAdapter } from '../infrastructure/adapters/inventory-master/shoper-inventory-master.adapter';
import { ShoperProductMasterAdapter } from '../infrastructure/adapters/product-master/shoper-product-master.adapter';
import { ShoperHttpClient } from '../infrastructure/http/shoper-http-client';
import { ShoperProductReader } from '../infrastructure/readers/shoper-product.reader';
import { ShoperShopContextProvider } from '../infrastructure/shop-context/shoper-shop-context.provider';
import { ShoperTaxTableProvider } from '../infrastructure/shop-context/shoper-tax-table.provider';

export interface ShoperAdapters {
  readonly productMaster: ShoperProductMasterAdapter;
  readonly inventoryMaster: ShoperInventoryMasterAdapter;
  /** Absent when the plugin was built without its Nest-provided dependencies. */
  readonly orderProcessor: ShoperOrderProcessorAdapter | null;
}

export class ShoperAdapterFactory {
  async createAdapters(
    connection: Connection,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
    fetchImpl: FetchLike,
    cache?: CachePort,
    customerProvisioner?: ShoperCustomerProvisioner,
    mappingConfig?: IMappingConfigService,
  ): Promise<ShoperAdapters> {
    const base = parseShoperBaseUrl((connection.config ?? {}).baseUrl);
    if (!base.ok) {
      throw new ShoperConfigException(connection.id, base.issues.join('; '));
    }
    if (!connection.credentialsRef) {
      throw new ShoperConfigException(connection.id, 'no stored credentials');
    }

    const credentials = await credentialsResolver.get<ShoperCredentials>(connection.credentialsRef);
    if (typeof credentials.token !== 'string' || credentials.token.trim().length === 0) {
      throw new ShoperConfigException(connection.id, 'stored credentials have no API token');
    }

    const client = new ShoperHttpClient({ host: base.host, token: credentials.token }, fetchImpl);
    const shopContext = new ShoperShopContextProvider(client, base.host, {
      cache,
      cacheKey: `shoper:shop-context:${connection.id}:${base.host}`,
    });

    // ONE product reader for the bag: ProductMaster and InventoryMaster read the
    // same `GET /products/:id`, so within one resolution the request is made
    // once. That saving is per BAG only - `getCapabilityAdapter` builds a fresh
    // bag on every call, so a product sync and an inventory sync each read the
    // product themselves. Reporting a deletion identically from both does not
    // rest on sharing the instance; it rests on both going through this class.
    const productReader = new ShoperProductReader(client, connection.id);
    const taxTable = new ShoperTaxTableProvider(client);

    return {
      productMaster: new ShoperProductMasterAdapter(
        client,
        identifierMapping,
        shopContext,
        taxTable,
        connection,
        productReader,
      ),
      inventoryMaster: new ShoperInventoryMasterAdapter(
        client,
        identifierMapping,
        shopContext,
        productReader,
        connection,
      ),
      orderProcessor:
        customerProvisioner === undefined
          ? null
          : new ShoperOrderProcessorAdapter(
              client,
              identifierMapping,
              customerProvisioner,
              taxTable,
              new ShoperOrderOptionsProvider(client),
              connection,
              mappingConfig,
            ),
    };
  }
}
