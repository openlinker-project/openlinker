/**
 * Empik Test OfferManager Harness Helper (#4277)
 *
 * Registers a test-only adapter key whose factory returns the REAL
 * `MiraklOfferManagerAdapter` over a `MiraklFakeOfferApi`, the real import
 * tracker and the real `MiraklOfferWriteRepository` on the test database. A
 * connection pointed at this key resolves through
 * `IntegrationsService.getCapabilityAdapter`, so core's inventory write-back
 * and the reconcile service drive it exactly as in production; only the
 * transport is faked.
 *
 * Suite-scoped: call once in `beforeAll`.
 *
 * @module apps/api/test/integration/helpers
 */
import type {
  AdapterFactoryResolverService,
  AdapterRegistryPort,
} from '@openlinker/core/integrations';
import {
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  ADAPTER_REGISTRY_TOKEN,
} from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { empikOperatorProfile } from '@openlinker/integrations-mirakl';
import { MiraklOfferManagerAdapter } from '@openlinker/integrations-mirakl/infrastructure/adapters/mirakl-offer-manager.adapter';
import { MiraklImportTracker } from '@openlinker/integrations-mirakl/infrastructure/imports/mirakl-import-tracker';
import { MiraklOfferWriteOrmEntity } from '@openlinker/integrations-mirakl/infrastructure/persistence/entities/mirakl-offer-write.orm-entity';
import { MiraklOfferWriteRepository } from '@openlinker/integrations-mirakl/infrastructure/persistence/repositories/mirakl-offer-write.repository';

import type { IntegrationTestHarness } from '../setup';
import { MiraklFakeOfferApi } from './mirakl-fake-offer-api';

export const EMPIK_OFFER_MANAGER_TEST_ADAPTER_KEY = 'empik.offermanager.test.v1';
export const EMPIK_OFFER_MANAGER_TEST_PLATFORM_TYPE = 'empik';

export interface EmpikOfferManagerHarness {
  readonly fake: MiraklFakeOfferApi;
  readonly repository: MiraklOfferWriteRepository;
}

export function installEmpikOfferManagerHarness(
  harness: IntegrationTestHarness
): EmpikOfferManagerHarness {
  const app = harness.getApp();
  const fake = new MiraklFakeOfferApi();
  const repository = new MiraklOfferWriteRepository(
    harness.getDataSource().getRepository(MiraklOfferWriteOrmEntity)
  );

  app.get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN).register({
    adapterKey: EMPIK_OFFER_MANAGER_TEST_ADAPTER_KEY,
    platformType: EMPIK_OFFER_MANAGER_TEST_PLATFORM_TYPE,
    supportedCapabilities: ['OfferManager'],
    displayName: 'Empik OfferManager (integration-test, fake HTTP)',
    version: '0.0.0-test',
    isDefault: false,
  });
  app
    .get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN)
    .registerFactory(EMPIK_OFFER_MANAGER_TEST_ADAPTER_KEY, {
      createCapabilityAdapter: <T>(connection: Connection): Promise<T> => {
        const adapter = new MiraklOfferManagerAdapter({
          connectionId: connection.id,
          adapterKey: EMPIK_OFFER_MANAGER_TEST_ADAPTER_KEY,
          brand: 'Empik',
          httpClient: fake,
          importTracker: new MiraklImportTracker(fake, connection.id),
          writes: repository,
          taxonomyOwner: 'empik:staging',
          offerDefaults: { leadTimeToShip: 2, logisticClass: '1' },
          cardAttributes: empikOperatorProfile.cardAttributes,
        });
        return Promise.resolve(adapter as unknown as T);
      },
    });

  return { fake, repository };
}
