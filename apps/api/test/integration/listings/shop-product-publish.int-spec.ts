/**
 * Shop Product Publish Integration Test (#1042)
 *
 * Exercises `ProductPublishExecutionService.executePublish` end-to-end against
 * real Postgres (Testcontainers; migration `AddListingCreationRecordsTable1806…`
 * applied by the harness) with a **fake** `ShopProductManagerPort` +
 * `CategoryProvisioner` and a **fake** `ProductMaster`, both registered through
 * the production `AdapterRegistryService` + `AdapterFactoryResolverService`
 * seams (the carrier-mapping / bulk-wizard precedent). Asserts:
 *  - first publish persists a `listing_creation_records` row + the `ShopProduct`
 *    identifier mapping, outcome `ok`;
 *  - re-publish upserts (command carries `externalProductId`, no duplicate
 *    mapping);
 *  - a rejecting adapter yields `business_failure` + a `failed` record.
 *
 * The full builder→adapter logic is also unit-tested against fakes
 * (`product-publish-{builder,execution}.service.spec.ts`); this spec proves the
 * Nest wiring + the new migration + real persistence.
 *
 * @module apps/api/test/integration/listings
 */
import {
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  ADAPTER_REGISTRY_TOKEN,
  AdapterFactoryResolverService,
  AdapterRegistryPort,
} from '@openlinker/core/integrations';
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import {
  type IProductPublishExecutionService,
  PRODUCT_PUBLISH_EXECUTION_SERVICE_TOKEN,
} from '@openlinker/core/listings';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from '../setup';
import { createTestConnection } from '../helpers/test-connection.helper';
import {
  installShopTestPublisherStub,
  type ShopTestPublisherStub,
} from '../helpers/shop-test-product-publisher-stub.helper';

const PRODUCT_MASTER_ADAPTER_KEY = 'product.test.master.v1';
const PRODUCT_ID = 'ol_product_int1';
const VARIANT_ID = 'ol_variant_int1';

function installProductMasterStub(harness: IntegrationTestHarness): void {
  const registry = harness.getApp().get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
  const resolver = harness
    .getApp()
    .get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);

  const stub = {
    getProduct: (): Promise<unknown> =>
      Promise.resolve({
        id: PRODUCT_ID,
        name: 'Integration Widget',
        description: 'Seeded widget',
        images: ['http://example/img.png'],
        price: 19.99,
        currency: 'PLN',
        categories: ['src-leaf'],
      }),
    getProductCategories: (): Promise<unknown> =>
      Promise.resolve([{ id: 'src-leaf', name: 'Gadgets', depth: 0 }]),
  };

  registry.register({
    adapterKey: PRODUCT_MASTER_ADAPTER_KEY,
    platformType: 'prestashop',
    supportedCapabilities: ['ProductMaster'],
    displayName: 'ProductMaster (integration-test stub)',
    version: '0.0.0-test',
    isDefault: false,
  });
  resolver.registerFactory(PRODUCT_MASTER_ADAPTER_KEY, {
    createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(stub as unknown as T),
  });
}

describe('Shop Product Publish Integration (#1042)', () => {
  let harness: IntegrationTestHarness;
  let publisher: ShopTestPublisherStub;
  let shopConnectionId: string;

  beforeAll(async () => {
    harness = await getTestHarness();
    publisher = installShopTestPublisherStub(harness);
    installProductMasterStub(harness);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  function execution(): IProductPublishExecutionService {
    return harness
      .getApp()
      .get<IProductPublishExecutionService>(PRODUCT_PUBLISH_EXECUTION_SERVICE_TOKEN);
  }

  beforeEach(async () => {
    publisher.reset();

    const master = await createTestConnection(harness.getDataSource(), {
      platformType: 'prestashop',
      name: 'Master catalog',
      adapterKey: PRODUCT_MASTER_ADAPTER_KEY,
      enabledCapabilities: ['ProductMaster'],
    });

    const shop = await createTestConnection(harness.getDataSource(), {
      platformType: publisher.platformType,
      name: 'Shop destination',
      adapterKey: publisher.adapterKey,
      enabledCapabilities: ['ProductPublisher', 'CategoryProvisioner'],
      config: { masterCatalogConnectionId: master.id },
    });
    shopConnectionId = shop.id;

    // Seed the master product + variant (real DB rows the builder reads via
    // IProductsService.getVariant). Raw SQL — there is no products orm-entities
    // sub-barrel to import in tests.
    const ds = harness.getDataSource();
    await ds.query(
      `INSERT INTO products (id, name, "createdAt", "updatedAt") VALUES ($1, $2, now(), now())`,
      [PRODUCT_ID, 'Integration Widget']
    );
    await ds.query(
      `INSERT INTO product_variants (id, "productId", attributes, "createdAt", "updatedAt")
       VALUES ($1, $2, $3::jsonb, now(), now())`,
      [VARIANT_ID, PRODUCT_ID, JSON.stringify({})]
    );
  });

  async function countRecordsForConnection(connectionId: string): Promise<number> {
    const rows = (await harness
      .getDataSource()
      .query(`SELECT count(*)::int AS n FROM listing_creation_records WHERE "connectionId" = $1`, [
        connectionId,
      ])) as { n: number }[];
    return rows[0].n;
  }

  it('publishes a new product, persisting the record + ShopProduct mapping (ok)', async () => {
    publisher.setNextPublishResult(VARIANT_ID, {
      kind: 'success',
      externalProductId: 'wc-100',
      status: 'published',
    });

    const result = await execution().executePublish({
      internalVariantId: VARIANT_ID,
      connectionId: shopConnectionId,
      stock: 4,
      status: 'published',
    });

    expect(result.outcome).toBe('ok');
    expect(result.listingCreationRecord.status).toBe('published');
    expect(result.listingCreationRecord.externalProductId).toBe('wc-100');

    // The real AttributeProjectionService ran (category was provisioned) and
    // resolved the destination under 'ProductPublisher' without throwing. The
    // stub is not a CategoryParametersReader and no attribute mappings are
    // seeded → name-keyed pass-through yields no parameters.
    expect(publisher.lastCommand()?.destinationCategoryIds).toEqual(['dest:src-leaf']);
    expect(publisher.lastCommand()?.parameters).toBeUndefined();

    // Real persistence: the record row exists.
    const rows = (await harness
      .getDataSource()
      .query(`SELECT status, "externalProductId" FROM listing_creation_records WHERE id = $1`, [
        result.listingCreationRecord.id,
      ])) as { status: string; externalProductId: string }[];
    expect(rows[0]).toEqual({ status: 'published', externalProductId: 'wc-100' });

    // Real persistence: the ShopProduct mapping was created, connection-scoped.
    const mapping = harness
      .getApp()
      .get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);
    const externalIds = await mapping.getExternalIds(CORE_ENTITY_TYPE.ShopProduct, VARIANT_ID);
    expect(externalIds.find((m) => m.connectionId === shopConnectionId)?.externalId).toBe('wc-100');
  });

  it('upserts on re-publish — command carries externalProductId, no duplicate record blow-up', async () => {
    publisher.setNextPublishResult(VARIANT_ID, {
      kind: 'success',
      externalProductId: 'wc-100',
      status: 'published',
    });
    await execution().executePublish({
      internalVariantId: VARIANT_ID,
      connectionId: shopConnectionId,
      stock: 4,
      status: 'published',
    });

    // Second publish: mapping now exists → upsert path.
    publisher.setNextPublishResult(VARIANT_ID, {
      kind: 'success',
      externalProductId: 'wc-100',
      status: 'published',
    });
    const second = await execution().executePublish({
      internalVariantId: VARIANT_ID,
      connectionId: shopConnectionId,
      stock: 9,
      status: 'published',
    });

    expect(second.outcome).toBe('ok');
    // The adapter saw the existing external id (upsert).
    expect(publisher.lastCommand()?.externalProductId).toBe('wc-100');
    // Two attempt rows (one per publish) for this shop, still a single mapping.
    expect(await countRecordsForConnection(shopConnectionId)).toBe(2);
    const mapping = harness
      .getApp()
      .get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);
    const externalIds = await mapping.getExternalIds(CORE_ENTITY_TYPE.ShopProduct, VARIANT_ID);
    expect(externalIds.filter((m) => m.connectionId === shopConnectionId)).toHaveLength(1);
  });

  it('records business_failure when the shop rejects the publish', async () => {
    publisher.setNextPublishResult(VARIANT_ID, {
      kind: 'failure',
      statusCode: 422,
      errors: [{ code: 'INVALID_CATEGORY', message: 'bad category' }],
    });

    const result = await execution().executePublish({
      internalVariantId: VARIANT_ID,
      connectionId: shopConnectionId,
      stock: 4,
      status: 'published',
    });

    expect(result.outcome).toBe('business_failure');
    expect(result.listingCreationRecord.status).toBe('failed');
    expect(result.listingCreationRecord.errors?.[0]?.code).toBe('INVALID_CATEGORY');
  });
});
