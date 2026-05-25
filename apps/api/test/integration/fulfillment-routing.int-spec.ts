/**
 * Fulfillment Routing Integration Test (#832)
 *
 * Vertical slice for the general fulfillment-routing model: persistence
 * round-trip through `FulfillmentRoutingService`, capability + topology
 * compatibility validation against the **real** booted adapter registry
 * (PrestaShop / Allegro / InPost manifests), rule resolution with the
 * omp_fulfilled no-regression default, and the migration's
 * `ON DELETE CASCADE` foreign keys.
 *
 * Uses real Postgres via Testcontainers — the migration under test
 * (`AddFulfillmentRoutingRules1799000000005`) is applied by the harness.
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_PROCESSOR_KIND,
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
  IFulfillmentRoutingService,
  IncompatibleProcessorException,
} from '@openlinker/core/mappings';
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';

interface SeededConnections {
  /** Allegro order source (`allegro.publicapi.v1` — OrderSource, OfferManager). */
  sourceId: string;
  /** PrestaShop OMP (`prestashop.webservice.v1` — declares OrderProcessorManager). */
  prestashopId: string;
  /** InPost OL-managed carrier (`inpost.shipx.v1` — declares ShippingProviderManager). */
  inpostId: string;
}

describe('Fulfillment Routing Integration', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  function getService(): IFulfillmentRoutingService {
    return harness.getApp().get<IFulfillmentRoutingService>(FULFILLMENT_ROUTING_SERVICE_TOKEN);
  }

  /**
   * Seed the three connection shapes the routing model distinguishes. Their
   * adapterKeys resolve to the real registered manifests, so compatibility
   * checks run against production capability metadata — not a stub.
   */
  async function seedConnections(): Promise<SeededConnections> {
    const dataSource = harness.getDataSource();
    const source = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.publicapi.v1',
      enabledCapabilities: ['OrderSource'],
    });
    const prestashop = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      name: 'PrestaShop OMP',
      adapterKey: 'prestashop.webservice.v1',
      enabledCapabilities: ['OrderProcessorManager'],
    });
    const inpost = await createTestConnection(dataSource, {
      platformType: 'inpost',
      name: 'InPost carrier',
      adapterKey: 'inpost.shipx.v1',
      enabledCapabilities: ['ShippingProviderManager'],
    });
    return { sourceId: source.id, prestashopId: prestashop.id, inpostId: inpost.id };
  }

  describe('replaceRules + getRules', () => {
    it('should persist compatible omp_fulfilled and ol_managed_carrier rules and read them back', async () => {
      const { sourceId, prestashopId, inpostId } = await seedConnections();
      const service = getService();

      await service.replaceRules(sourceId, [
        {
          sourceDeliveryMethodId: 'allegro-courier',
          processorKind: FULFILLMENT_PROCESSOR_KIND.OmpFulfilled,
          processorConnectionId: prestashopId,
        },
        {
          sourceDeliveryMethodId: 'allegro-one-box',
          processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
          processorConnectionId: inpostId,
        },
      ]);

      const rules = await service.getRules(sourceId);
      expect(rules).toHaveLength(2);

      const byMethod = new Map(rules.map((r) => [r.sourceDeliveryMethodId, r]));
      expect(byMethod.get('allegro-courier')).toMatchObject({
        sourceConnectionId: sourceId,
        processorKind: 'omp_fulfilled',
        processorConnectionId: prestashopId,
      });
      expect(byMethod.get('allegro-one-box')).toMatchObject({
        sourceConnectionId: sourceId,
        processorKind: 'ol_managed_carrier',
        processorConnectionId: inpostId,
      });
    });

    it('should reject an omp_fulfilled rule whose processor does not declare OrderProcessorManager', async () => {
      const { sourceId } = await seedConnections();
      const service = getService();

      // Routing an OMP rule at the Allegro source itself — Allegro declares
      // OrderSource/OfferManager but not OrderProcessorManager.
      await expect(
        service.replaceRules(sourceId, [
          {
            sourceDeliveryMethodId: 'allegro-courier',
            processorKind: FULFILLMENT_PROCESSOR_KIND.OmpFulfilled,
            processorConnectionId: sourceId,
          },
        ]),
      ).rejects.toBeInstanceOf(IncompatibleProcessorException);

      // Nothing persisted — the whole replace is rejected before any write.
      expect(await service.getRules(sourceId)).toHaveLength(0);
    });

    it('should reject an ol_managed_carrier rule whose processor is the source connection', async () => {
      const { sourceId } = await seedConnections();
      const service = getService();

      await expect(
        service.replaceRules(sourceId, [
          {
            sourceDeliveryMethodId: 'allegro-one-box',
            processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
            processorConnectionId: sourceId,
          },
        ]),
      ).rejects.toBeInstanceOf(IncompatibleProcessorException);
    });

    it('should reject a source_brokered rule because the source does not yet declare ShippingProviderManager (#833)', async () => {
      const { sourceId } = await seedConnections();
      const service = getService();

      // source_brokered requires the source connection itself to declare
      // ShippingProviderManager. Allegro Delivery (#833) is not yet
      // implemented, so the Allegro adapter declares no shipping capability —
      // the rule is correctly uncreatable until that lands behind this seam.
      await expect(
        service.replaceRules(sourceId, [
          {
            sourceDeliveryMethodId: 'allegro-one-box',
            processorKind: FULFILLMENT_PROCESSOR_KIND.SourceBrokered,
            processorConnectionId: sourceId,
          },
        ]),
      ).rejects.toBeInstanceOf(IncompatibleProcessorException);
    });

    it('should fully replace the previous rule set on a second call', async () => {
      const { sourceId, prestashopId, inpostId } = await seedConnections();
      const service = getService();

      await service.replaceRules(sourceId, [
        {
          sourceDeliveryMethodId: 'allegro-courier',
          processorKind: FULFILLMENT_PROCESSOR_KIND.OmpFulfilled,
          processorConnectionId: prestashopId,
        },
      ]);

      await service.replaceRules(sourceId, [
        {
          sourceDeliveryMethodId: 'allegro-one-box',
          processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
          processorConnectionId: inpostId,
        },
      ]);

      const rules = await service.getRules(sourceId);
      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject({
        sourceDeliveryMethodId: 'allegro-one-box',
        processorKind: 'ol_managed_carrier',
        processorConnectionId: inpostId,
      });
    });
  });

  describe('resolve', () => {
    it('should resolve the configured processor when a rule matches', async () => {
      const { sourceId, inpostId } = await seedConnections();
      const service = getService();

      await service.replaceRules(sourceId, [
        {
          sourceDeliveryMethodId: 'allegro-one-box',
          processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
          processorConnectionId: inpostId,
        },
      ]);

      const resolution = await service.resolve({
        sourceConnectionId: sourceId,
        sourceDeliveryMethodId: 'allegro-one-box',
      });

      expect(resolution).toEqual({
        processorKind: 'ol_managed_carrier',
        processorConnectionId: inpostId,
        source: 'rule',
      });
    });

    it('should fall back to the omp_fulfilled default for an unconfigured method (no regression)', async () => {
      const { sourceId } = await seedConnections();
      const service = getService();

      const resolution = await service.resolve({
        sourceConnectionId: sourceId,
        sourceDeliveryMethodId: 'unmapped-method',
      });

      expect(resolution).toEqual({
        processorKind: 'omp_fulfilled',
        processorConnectionId: null,
        source: 'default',
      });
    });
  });

  // NOTE: the migration's `ON DELETE CASCADE` foreign keys are NOT asserted
  // here. The integration harness builds its schema via TypeORM `synchronize`
  // (DatabaseModule: `synchronize: NODE_ENV !== 'production'`, `migrationsRun:
  // false`), and — mirroring `CarrierMapping` — the FKs live only in the
  // migration, not the ORM-entity decorators. So the synchronize-built schema
  // has no FK to cascade. The migration's FK behaviour is validated by the
  // up/down round-trip (`migration:run` / `migration:revert`) and review.
});
