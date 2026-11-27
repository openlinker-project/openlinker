/**
 * Empik Test Catalogue-Master Harness Helper (#4284)
 *
 * Registers a test-only adapter key whose factory returns the REAL
 * `MiraklProductMasterAdapter` and `MiraklInventoryMasterAdapter` over a
 * `MiraklFakeOfferApi`, with the app's own identifier mapping, cache and lock,
 * and the real `mirakl_offer_writes` queue.
 * A connection pointed at this key therefore resolves through the production
 * path, and the masters' id, deletion and read-then-write rules all run; only
 * the transport is faked.
 *
 * Suite-scoped: call once in `beforeAll`; the registry refuses a second
 * registration of the same key.
 *
 * @module apps/api/test/integration/helpers
 */
import {
  IDENTIFIER_MAPPING_PORT_TOKEN,
  type Connection,
  type IdentifierMappingPort,
} from '@openlinker/core/identifier-mapping';
import type {
  AdapterFactoryResolverService,
  AdapterRegistryPort,
} from '@openlinker/core/integrations';
import {
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  ADAPTER_REGISTRY_TOKEN,
} from '@openlinker/core/integrations';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import { CACHE_PORT_TOKEN, type CachePort } from '@openlinker/shared';
import { MiraklInventoryMasterAdapter } from '@openlinker/integrations-mirakl/infrastructure/adapters/catalog-master/mirakl-inventory-master.adapter';
import { MiraklMasterIdentity } from '@openlinker/integrations-mirakl/infrastructure/adapters/catalog-master/mirakl-master-identity';
import { MiraklOfferReader } from '@openlinker/integrations-mirakl/infrastructure/adapters/catalog-master/mirakl-offer-reader';
import { MiraklProductMasterAdapter } from '@openlinker/integrations-mirakl/infrastructure/adapters/catalog-master/mirakl-product-master.adapter';
import { MiraklImportTracker } from '@openlinker/integrations-mirakl/infrastructure/imports/mirakl-import-tracker';
import { MiraklOfferWriteOrmEntity } from '@openlinker/integrations-mirakl/infrastructure/persistence/entities/mirakl-offer-write.orm-entity';
import { MiraklOfferWriteRepository } from '@openlinker/integrations-mirakl/infrastructure/persistence/repositories/mirakl-offer-write.repository';

import type { IntegrationTestHarness } from '../setup';
import { MiraklFakeOfferApi } from './mirakl-fake-offer-api';

export const EMPIK_MASTER_TEST_ADAPTER_KEY = 'empik.master.test.v1';
export const EMPIK_MASTER_TEST_PLATFORM_TYPE = 'empik';

export interface EmpikCatalogMasterHarness {
  readonly fake: MiraklFakeOfferApi;
  readonly writes: MiraklOfferWriteRepository;
}

export function installEmpikCatalogMasterHarness(
  harness: IntegrationTestHarness
): EmpikCatalogMasterHarness {
  const app = harness.getApp();
  const fake = new MiraklFakeOfferApi();
  const identifierMapping = app.get<IdentifierMappingPort>(IDENTIFIER_MAPPING_PORT_TOKEN);
  const cache = app.get<CachePort>(CACHE_PORT_TOKEN, { strict: false });
  const lock = app.get<SyncLockPort>(SYNC_LOCK_TOKEN, { strict: false });
  const writes = new MiraklOfferWriteRepository(
    harness.getDataSource().getRepository(MiraklOfferWriteOrmEntity)
  );

  app.get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN).register({
    adapterKey: EMPIK_MASTER_TEST_ADAPTER_KEY,
    platformType: EMPIK_MASTER_TEST_PLATFORM_TYPE,
    supportedCapabilities: ['ProductMaster', 'InventoryMaster'],
    displayName: 'Empik catalogue master (integration-test, fake HTTP)',
    version: '0.0.0-test',
    isDefault: false,
  });
  app
    .get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN)
    .registerFactory(EMPIK_MASTER_TEST_ADAPTER_KEY, {
      createCapabilityAdapter: <T>(connection: Connection, capability: string): Promise<T> => {
        const reader = new MiraklOfferReader(fake);
        const identity = new MiraklMasterIdentity(connection.id, identifierMapping);
        const adapter =
          capability === 'ProductMaster'
            ? new MiraklProductMasterAdapter(connection.id, 'Empik', reader, identity)
            : new MiraklInventoryMasterAdapter({
                connectionId: connection.id,
                brand: 'Empik',
                httpClient: fake,
                importTracker: new MiraklImportTracker(fake, connection.id),
                writes,
                reader,
                identity,
                cache,
                lock,
              });
        return Promise.resolve(adapter as unknown as T);
      },
    });

  return { fake, writes };
}
