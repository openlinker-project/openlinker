/**
 * Order ingestion edge cases (#4100)
 *
 * Two source behaviours against a real Postgres harness, with the channel
 * mocked at the adapter boundary (the established pattern of
 * `allegro-order-sync-e2e.int-spec.ts`):
 *
 * 1. Destination echo: an order the source says OpenLinker created is skipped
 *    BEFORE any id is minted, so no order record and no destination create.
 * 2. Bought-and-cancelled between polls (#4032): a `cancelled` feed event for
 *    an order OpenLinker has never seen still ends up as a persisted,
 *    cancelled record, and nothing is created at a destination.
 *
 * NOT covered here, and why: the awaiting-payment hold needs an OMS router
 * bound to the harness, and the cancel-on-update relay needs a destination
 * that holds a synced copy; both are asserted at unit level only.
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { createMockAllegroMarketplaceAdapter } from './helpers/mock-allegro-adapters.helper';
import { INTEGRATIONS_SERVICE_TOKEN, IIntegrationsService } from '@openlinker/core/integrations';
import type { IncomingOrder, OrderProcessorManagerPort } from '@openlinker/core/orders';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  CORE_ENTITY_TYPE,
} from '@openlinker/core/identifier-mapping';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import { OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

describe('Order ingestion edge cases (#4100)', () => {
  let harness: WorkerIntegrationTestHarness;
  let dataSource: DataSource;
  let integrationsService: IIntegrationsService;
  let identifierMapping: IIdentifierMappingService;
  let source: ReturnType<typeof createMockAllegroMarketplaceAdapter>;
  let destination: jest.Mocked<OrderProcessorManagerPort>;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    integrationsService = harness.get(INTEGRATIONS_SERVICE_TOKEN);
    identifierMapping = harness.get(IDENTIFIER_MAPPING_SERVICE_TOKEN);
    process.env.CREDENTIALS_TEST_CREDENTIALS_REF =
      '{"accessToken":"test-token","refreshToken":"test-refresh"}';
  });

  beforeEach(async () => {
    await resetTestHarness();
    source = createMockAllegroMarketplaceAdapter();
    destination = {
      createOrder: jest.fn().mockResolvedValue({ orderId: randomUUID(), orderNumber: 'PS-1' }),
    } as unknown as jest.Mocked<OrderProcessorManagerPort>;
    jest
      .spyOn(integrationsService, 'getCapabilityAdapter')
      .mockImplementation(async (_id: string, capability: string) => {
        if (capability === 'OrderSource' || capability === 'OfferManager') return source as never;
        if (capability === 'OrderProcessorManager') return destination as never;
        throw new Error(`Unsupported capability: ${capability}`);
      });
    jest
      .spyOn(integrationsService, 'listCapabilityAdapters')
      .mockImplementation(async (filters: { capability: string }) =>
        filters.capability === 'OrderProcessorManager'
          ? ([
              {
                connectionId: 'dest-prestashop-1',
                connection: {} as never,
                adapter: destination as never,
                metadata: {} as never,
              },
            ] as never)
          : []
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function seedSourceWithVariant(): Promise<string> {
    const connection = await createTestConnection(dataSource, {
      platformType: 'allegro',
      status: 'active',
      credentialsRef: 'test-credentials-ref',
      adapterKey: 'allegro.publicapi.v1',
    });
    const product = new ProductOrmEntity();
    product.id = `ol_product_${randomUUID()}`;
    product.name = 'Edge product';
    await dataSource.getRepository(ProductOrmEntity).save(product);
    const variant = new ProductVariantOrmEntity();
    variant.id = `ol_variant_${randomUUID()}`;
    variant.productId = product.id;
    await dataSource.getRepository(ProductVariantOrmEntity).save(variant);
    await identifierMapping.createMapping('Offer', 'offer-1', connection.id, variant.id);
    return connection.id;
  }

  function getIngestion(): { syncOrderFromSource(...args: unknown[]): Promise<unknown> } {
    const { ORDER_INGESTION_SERVICE_TOKEN } = require('@openlinker/core/orders');
    return harness.get(ORDER_INGESTION_SERVICE_TOKEN);
  }

  it('should skip an order the source says OpenLinker created, minting no id and creating nothing', async () => {
    const connectionId = await seedSourceWithVariant();
    const echo = {
      ...(await source.getOrder({ externalOrderId: 'echo-1' })),
      createdFromInternalOrderId: 'ol_order_original',
    } as IncomingOrder;
    (source.getOrder as jest.Mock).mockResolvedValue(echo);

    await getIngestion().syncOrderFromSource(connectionId, 'echo-1');

    expect(destination.createOrder).not.toHaveBeenCalled();
    expect(
      await identifierMapping.getInternalId(CORE_ENTITY_TYPE.Order, 'echo-1', connectionId)
    ).toBeNull();
    expect(await dataSource.getRepository(OrderRecordOrmEntity).count()).toBe(0);
  });

  it('should ingest an order bought and cancelled between polls as a cancelled record (#4032)', async () => {
    const connectionId = await seedSourceWithVariant();
    const base = await source.getOrder({ externalOrderId: 'gone-1' });
    (source.getOrder as jest.Mock).mockResolvedValue({ ...base, status: 'cancelled' });

    await getIngestion().syncOrderFromSource(connectionId, 'gone-1', 'evt-1', 'cancelled');

    const internalId = await identifierMapping.getInternalId(
      CORE_ENTITY_TYPE.Order,
      'gone-1',
      connectionId
    );
    expect(internalId).not.toBeNull();
    const record = await dataSource
      .getRepository(OrderRecordOrmEntity)
      .findOne({ where: { internalOrderId: internalId as string } });
    expect(record?.cancelledAt).not.toBeNull();
    expect(destination.createOrder).not.toHaveBeenCalled();
  });
});
