/**
 * Empik Catalogue and Stock Master Integration Test (#4284)
 *
 * Runs an Empik connection as ProductMaster + InventoryMaster end to end: the
 * REAL `MiraklProductMasterAdapter` / `MiraklInventoryMasterAdapter` over an
 * in-memory Mirakl offer API, the production adapter-resolution seam, the REAL
 * master product and inventory sync services, the REAL stock correction
 * service, the REAL offer-writes reconcile pass that sends the queued stock,
 * and real Postgres and Redis.
 *
 * Offer shapes follow OF21 as Empik staging answered it on 2026-11-23.
 *
 * @module apps/api/test/integration/empik
 */
import { randomUUID } from 'crypto';
import type { DataSource } from 'typeorm';
import { encryptWithKey, loadEncryptionKey } from '@openlinker/shared';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { IntegrationCredentialOrmEntity } from '@openlinker/core/integrations/orm-entities';
import {
  INVENTORY_CORRECTION_SERVICE_TOKEN,
  MASTER_INVENTORY_SYNC_SERVICE_TOKEN,
  type IInventoryCorrectionService,
  type IMasterInventorySyncService,
} from '@openlinker/core/inventory';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';
import {
  OFFER_QUANTITY_ACK_RECONCILE_SERVICE_TOKEN,
  type IOfferQuantityAckReconcileService,
} from '@openlinker/core/listings';
import {
  MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
  type IMasterProductSyncService,
} from '@openlinker/core/products';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';

import type { IntegrationTestHarness } from '../setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import {
  EMPIK_MASTER_TEST_ADAPTER_KEY,
  EMPIK_MASTER_TEST_PLATFORM_TYPE,
  installEmpikCatalogMasterHarness,
  type EmpikCatalogMasterHarness,
} from '../helpers/empik-test-catalog-master.helper';

const SKU = 'OL-EMPIK-1';

describe('Empik catalogue and stock master (#4284)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let empik: EmpikCatalogMasterHarness;
  let connectionId: string;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    empik = installEmpikCatalogMasterHarness(harness);
  });

  beforeEach(async () => {
    connectionId = await seedEmpikMasterConnection(dataSource);
    empik.fake.putOffer({
      shop_sku: SKU,
      product_title: 'Wiedzmin. Ostatnie zyczenie',
      product_description: 'Zbior opowiadan',
      product_brand: 'SuperNowa',
      product_references: [{ reference_type: 'EAN', reference: '9788375780635' }],
      category_code: 'KSIAZKI',
      category_label: 'Ksiazki',
      price: 44.9,
      currency_iso_code: 'PLN',
      quantity: 10,
    });
  });

  afterEach(async () => {
    empik.fake.reset();
    jest.restoreAllMocks();
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  function productSync(): IMasterProductSyncService {
    return harness.getApp().get<IMasterProductSyncService>(MASTER_PRODUCT_SYNC_SERVICE_TOKEN);
  }

  function inventorySync(): IMasterInventorySyncService {
    return harness.getApp().get<IMasterInventorySyncService>(MASTER_INVENTORY_SYNC_SERVICE_TOKEN);
  }

  async function syncedVariant(): Promise<ProductVariantOrmEntity> {
    const variants = await dataSource.getRepository(ProductVariantOrmEntity).find();
    expect(variants).toHaveLength(1);
    return variants[0];
  }

  it('M1: reads an Empik offer in as a product with one variant, no images', async () => {
    await productSync().syncFromMasterByExternalId(connectionId, SKU);

    const products = await dataSource.getRepository(ProductOrmEntity).find();
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ name: 'Wiedzmin. Ostatnie zyczenie', sku: SKU });
    expect(products[0].images ?? []).toEqual([]);
    const variant = await syncedVariant();
    expect(variant).toMatchObject({ productId: products[0].id, sku: SKU, ean: '9788375780635' });
  });

  it('M2: mirrors the offer quantity as a pooled position owned by the connection', async () => {
    await productSync().syncFromMasterByExternalId(connectionId, SKU);
    await inventorySync().syncFromMasterByExternalId(connectionId, SKU);

    const rows = await dataSource
      .getRepository(InventoryItemOrmEntity)
      .find({ where: { isStale: false } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      availableQuantity: 10,
      locationId: null,
      sourceConnectionId: connectionId,
      productVariantId: (await syncedVariant()).id,
    });
  });

  it('M3: a stock correction is queued, then sent to Empik as one absolute STO01 line', async () => {
    await productSync().syncFromMasterByExternalId(connectionId, SKU);
    await inventorySync().syncFromMasterByExternalId(connectionId, SKU);
    const variant = await syncedVariant();
    const correction = harness
      .getApp()
      .get<IInventoryCorrectionService>(INVENTORY_CORRECTION_SERVICE_TOKEN);
    const correct = (quantity: number): ReturnType<IInventoryCorrectionService['correctStock']> =>
      correction.correctStock({
        productVariantId: variant.id,
        mode: 'delta',
        quantity,
        operatorReason: 'count_correction',
        idempotencyKey: randomUUID(),
        actorUserId: 'user-1',
      });

    // Two changes inside Mirakl's one-file-per-30-seconds window.
    await expect(correct(-3)).resolves.toMatchObject({ status: 'applied', quantityAfter: 7 });
    await expect(correct(-1)).resolves.toMatchObject({ status: 'applied', quantityAfter: 6 });
    expect(empik.fake.imports).toEqual([]);

    await harness
      .getApp()
      .get<IOfferQuantityAckReconcileService>(OFFER_QUANTITY_ACK_RECONCILE_SERVICE_TOKEN)
      .reconcile(connectionId, 50);

    expect(empik.fake.imports).toEqual([
      expect.objectContaining({
        path: '/api/offers/stock/imports',
        content: `offer-sku;quantity\n${SKU};6\n`,
      }),
    ]);
    expect(await empik.writes.findLatest(connectionId, 'stock', SKU)).toMatchObject({
      status: 'submitted',
      value: '6',
    });
  });

  it('M4: an offer gone from Empik stales the product it was read in as', async () => {
    await productSync().syncFromMasterByExternalId(connectionId, SKU);
    empik.fake.reset();

    await productSync().syncFromMasterByExternalId(connectionId, SKU);

    expect((await syncedVariant()).isStale).toBe(true);
  });
});

async function seedEmpikMasterConnection(dataSource: DataSource): Promise<string> {
  const credentialsRef = `test-empik-${randomUUID()}`;
  const { key } = loadEncryptionKey(process.env);
  const credRepo = dataSource.getRepository(IntegrationCredentialOrmEntity);
  await credRepo.save(
    credRepo.create({
      ref: credentialsRef,
      platformType: EMPIK_MASTER_TEST_PLATFORM_TYPE,
      credentialsCiphertext: encryptWithKey(
        key,
        JSON.stringify({ apiKey: 'test-empik-key-not-real' })
      ),
    })
  );
  const connRepo = dataSource.getRepository(ConnectionOrmEntity);
  const connection = await connRepo.save(
    connRepo.create({
      platformType: EMPIK_MASTER_TEST_PLATFORM_TYPE,
      name: 'Test Empik master connection',
      status: 'active',
      config: {},
      credentialsRef: `db:${credentialsRef}`,
      adapterKey: EMPIK_MASTER_TEST_ADAPTER_KEY,
      enabledCapabilities: ['ProductMaster', 'InventoryMaster'],
    })
  );
  return connection.id;
}
