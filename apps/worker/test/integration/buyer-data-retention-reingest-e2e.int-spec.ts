/**
 * Buyer data retention: re-ingesting an erased order (#4289)
 *
 * Full ingestion path against real Postgres, channel mocked at the adapter
 * boundary. An erased order that the source then re-delivers with fresh buyer
 * data must not get that data back into the customer projection, must not
 * record a false address amendment, and must keep its erased snapshot, while
 * its non-personal fields still refresh.
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { createMockAllegroMarketplaceAdapter } from './helpers/mock-allegro-adapters.helper';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import {
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  CORE_ENTITY_TYPE,
} from '@openlinker/core/identifier-mapping';
import {
  ORDER_INGESTION_SERVICE_TOKEN,
  ORDER_RECORD_REPOSITORY_TOKEN,
  eraseBuyerPersonalDataFromSnapshot,
  type IncomingOrder,
  type OrderProcessorManagerPort,
} from '@openlinker/core/orders';
import {
  CUSTOMER_PROJECTION_SERVICE_TOKEN,
  type ICustomerProjectionService,
} from '@openlinker/core/customers';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import { OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import type { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

/**
 * The erase seam the retention sweep drives, restated structurally: the
 * repository port itself is intra-context and may not be imported here.
 */
interface ErasePass {
  findErasableOrdersForBuyerDataRetention(
    connectionId: string,
    before: Date,
    limit: number
  ): Promise<{ internalOrderId: string; orderSnapshot: Record<string, unknown> }[]>;
  erasePersonalDataForRetention(
    erasures: {
      internalOrderId: string;
      orderSnapshot: Record<string, unknown>;
      searchText: string;
      hide: boolean;
    }[],
    now: Date
  ): Promise<{ erased: number; customerIds: string[] }>;
  findCustomerIdsWithoutPersonalDataOrders(ids: readonly string[]): Promise<string[]>;
}

describe('Buyer data retention: re-ingestion of an erased order (#4289)', () => {
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
    jest.spyOn(integrationsService, 'listCapabilityAdapters').mockResolvedValue([] as never);
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
    product.name = 'Retention product';
    await dataSource.getRepository(ProductOrmEntity).save(product);
    const variant = new ProductVariantOrmEntity();
    variant.id = `ol_variant_${randomUUID()}`;
    variant.productId = product.id;
    await dataSource.getRepository(ProductVariantOrmEntity).save(variant);
    await identifierMapping.createMapping('Offer', 'offer-1', connection.id, variant.id);
    return connection.id;
  }

  function buyerOrder(base: IncomingOrder, street: string, status: IncomingOrder['status']) {
    return {
      ...base,
      status,
      customerEmail: 'jan.kowalski@example.com',
      shippingAddress: {
        ...base.shippingAddress,
        firstName: 'Jan',
        lastName: 'Kowalski',
        address1: street,
      },
    } as IncomingOrder;
  }

  it('should keep the projection cleared, record no amendment and refresh only non-personal fields', async () => {
    const connectionId = await seedSourceWithVariant();
    const ingestion = harness.get(ORDER_INGESTION_SERVICE_TOKEN);
    const orders = harness.get(ORDER_RECORD_REPOSITORY_TOKEN) as ErasePass;
    const customers = harness.get(CUSTOMER_PROJECTION_SERVICE_TOKEN) as ICustomerProjectionService;
    const base = await source.getOrder({ externalOrderId: 'ret-1' });

    (source.getOrder as jest.Mock).mockResolvedValue(buyerOrder(base, 'Old Street 1', 'pending'));
    await ingestion.syncOrderFromSource(connectionId, 'ret-1');

    const internalId = (await identifierMapping.getInternalId(
      CORE_ENTITY_TYPE.Order,
      'ret-1',
      connectionId
    )) as string;
    const recordRepo = dataSource.getRepository(OrderRecordOrmEntity);
    const readProjection = async (id: string) =>
      (
        await dataSource.query(
          `SELECT "normalizedEmail", "firstName", "lastName" FROM customer_projections WHERE "internalCustomerId" = $1`,
          [id]
        )
      )[0];
    const before = await recordRepo.findOneByOrFail({ internalOrderId: internalId });
    expect(before.customerId).not.toBeNull();
    const customerId = before.customerId as string;
    expect((await readProjection(customerId)).normalizedEmail).toBe('jan.kowalski@example.com');

    // Age the order, then erase it the way the retention sweep does.
    await dataSource.query(
      `UPDATE order_records SET "placedAt" = now() - interval '400 days' WHERE "internalOrderId" = $1`,
      [internalId]
    );
    const rows = await orders.findErasableOrdersForBuyerDataRetention(
      connectionId,
      new Date(Date.now() - 365 * 86_400_000),
      10
    );
    expect(rows.map((r) => r.internalOrderId)).toContain(internalId);
    const result = await orders.erasePersonalDataForRetention(
      rows.map((r) => ({
        internalOrderId: r.internalOrderId,
        orderSnapshot: eraseBuyerPersonalDataFromSnapshot(r.orderSnapshot, r.internalOrderId),
        searchText: 'x',
        hide: false,
      })),
      new Date()
    );
    expect(result.erased).toBe(1);
    await customers.clearPersonalData(
      await orders.findCustomerIdsWithoutPersonalDataOrders(result.customerIds)
    );

    const erasedRow = await recordRepo.findOneByOrFail({ internalOrderId: internalId });
    const amendedAtBefore = erasedRow.lastAmendedAt;
    const changesBefore = erasedRow.lastAmendmentChanges;

    // The source re-delivers the order with fresh buyer data and a new status.
    (source.getOrder as jest.Mock).mockResolvedValue(
      buyerOrder(base, 'Brand New Street 9', 'shipped')
    );
    await ingestion.syncOrderFromSource(connectionId, 'ret-1');

    const projection = await readProjection(customerId);
    expect(projection.normalizedEmail).toBeNull();
    expect(projection.firstName).toBeNull();
    expect(projection.lastName).toBeNull();
    const addresses: Record<string, unknown>[] = await dataSource.query(
      `SELECT address1, address2, city, postcode FROM customer_address_projections WHERE "internalCustomerId" = $1`,
      [customerId]
    );
    for (const a of addresses) {
      expect(Object.values(a).every((v) => v === null)).toBe(true);
    }

    const after = await recordRepo.findOneByOrFail({ internalOrderId: internalId });
    expect(after.lastAmendedAt).toEqual(amendedAtBefore);
    expect(after.lastAmendmentChanges).toEqual(changesBefore);
    expect(after.personalDataErasedAt).not.toBeNull();
    const text = JSON.stringify(after.orderSnapshot);
    expect(text).not.toContain('jan.kowalski@example.com');
    expect(text).not.toContain('Kowalski');
    expect(text).not.toContain('Brand New Street');
    expect((after.orderSnapshot as { status?: string }).status).toBe('shipped');
  });
});
