/**
 * WooCommerce ShopProduct Inventory Write-Back Vertical-Slice Int-Spec (#1498)
 *
 * Exercises the composition the review on PR #1508 flagged as untested: the
 * `ShopProduct` fan-out branch added to `InventoryPropagateToMarketplacesHandler`
 * → the generic `marketplace.offerQuantity.update` job → the REAL
 * `WooCommerceOfferManagerAdapter`, resolved through the production
 * `IntegrationsService` adapter-registry seam (not a mocked adapter). The
 * per-branch unit coverage (eligibility predicate, authority-guard exclusion,
 * dedup-key distinctness, adapter id/quantity validation, 404-as-clean-skip)
 * already exists and is NOT re-asserted here — this spec proves those pieces
 * COMPOSE correctly end-to-end.
 *
 * Faking at the HTTP-transport seam (not the adapter seam, `WooCommerceFakeHttpClient`)
 * mirrors the Erli offers vertical-slice pattern (#991) and keeps a live
 * WooCommerce Testcontainer unnecessary — the adapter's own request-building
 * logic is out of scope here (see woocommerce-utils.spec.ts /
 * woocommerce-offer-manager.adapter.spec.ts for that).
 *
 * @module apps/worker/test/integration
 */
import { randomUUID } from 'crypto';
import type { DataSource } from 'typeorm';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import {
  installWooCommerceOfferManagerTestHarness,
  type WooCommerceOfferManagerHarness,
} from './helpers/woocommerce-offer-manager-test-harness.helper';
import { JOB_ENQUEUE_TOKEN, SYNC_JOBS_SERVICE_TOKEN } from '@openlinker/core/sync';
import type { JobEnqueuePort, ISyncJobsService } from '@openlinker/core/sync';
import {
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  CORE_ENTITY_TYPE,
} from '@openlinker/core/identifier-mapping';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import { INVENTORY_SERVICE_TOKEN, InventoryItemEntity as InventoryItem } from '@openlinker/core/inventory';
import type { IInventoryService } from '@openlinker/core/inventory';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import { InventoryPropagateToMarketplacesHandler } from '../../src/sync/handlers/inventory-propagate-to-marketplaces.handler';
import { MarketplaceOfferQuantityUpdateHandler } from '../../src/sync/handlers/marketplace-offer-quantity-update.handler';

describe('WooCommerce ShopProduct inventory write-back vertical slice (#1498)', () => {
  let harness: WorkerIntegrationTestHarness;
  let dataSource: DataSource;
  let wc: WooCommerceOfferManagerHarness;
  let identifierMapping: IIdentifierMappingService;
  let inventoryService: IInventoryService;
  let jobEnqueue: JobEnqueuePort;
  let syncJobsService: ISyncJobsService;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    wc = installWooCommerceOfferManagerTestHarness(harness);
    identifierMapping = harness.get(IDENTIFIER_MAPPING_SERVICE_TOKEN);
    inventoryService = harness.get(INVENTORY_SERVICE_TOKEN);
    jobEnqueue = harness.get(JOB_ENQUEUE_TOKEN);
    syncJobsService = harness.get(SYNC_JOBS_SERVICE_TOKEN);
  });

  beforeEach(async () => {
    await resetTestHarness();
    wc.fake.reset();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  /** Seed the product + variant rows inventory_items FKs against. */
  async function seedProductAndVariant(productId: string, variantId: string): Promise<void> {
    const productRepo = dataSource.getRepository(ProductOrmEntity);
    await productRepo.save(productRepo.create({ id: productId, name: 'Test product' }));
    const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
    await variantRepo.save(variantRepo.create({ id: variantId, productId }));
  }

  /** Seed inventory then run the fan-out handler for that product/variant. */
  async function seedAndPropagate(
    productId: string,
    variantId: string,
    quantity: number,
  ): Promise<void> {
    await seedProductAndVariant(productId, variantId);
    await inventoryService.setInventory(
      new InventoryItem(randomUUID(), productId, variantId, quantity, 0, null, new Date()),
    );

    const handler = harness.get<InventoryPropagateToMarketplacesHandler>(
      InventoryPropagateToMarketplacesHandler,
    );

    const now = new Date();
    await handler.execute({
      id: randomUUID(),
      jobType: 'inventory.propagateToMarketplaces',
      connectionId: '00000000-0000-0000-0000-000000000000',
      payload: { productId, variantId },
      idempotencyKey: `test-propagate-${randomUUID()}`,
      status: 'running',
      attempts: 0,
      maxAttempts: 10,
      nextRunAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  it('enqueues a marketplace.offerQuantity.update job for an eligible ShopProduct mapping, and executing it PUTs the stock to WooCommerce', async () => {
    const connection = await createTestConnection(dataSource, {
      platformType: wc.platformType,
      status: 'active',
      credentialsRef: 'test-credentials-ref',
      adapterKey: wc.adapterKey,
      enabledCapabilities: ['OfferManager'],
    });

    const productId = `ol_product_${randomUUID().replace(/-/g, '')}`;
    const variantId = `ol_variant_${randomUUID().replace(/-/g, '')}`;
    const externalWcProductId = '4242';
    await identifierMapping.createMapping(
      CORE_ENTITY_TYPE.ShopProduct,
      externalWcProductId,
      connection.id,
      variantId,
    );

    const enqueueSpy = jest.spyOn(jobEnqueue, 'enqueueJob');

    await seedAndPropagate(productId, variantId, 17);

    const shopJobCall = enqueueSpy.mock.calls
      .map(([request]) => request)
      .find((request) => request.connectionId === connection.id);
    expect(shopJobCall).toBeDefined();
    expect(shopJobCall?.jobType).toBe('marketplace.offerQuantity.update');
    expect(shopJobCall?.payload).toMatchObject({ offerId: externalWcProductId, quantity: 17 });

    // Persist + execute the enqueued job through the SAME generic handler
    // production jobs run through (mirrors allegro-offer-quantity-update-e2e.int-spec.ts).
    const persistedJob = await syncJobsService.schedule({
      jobType: shopJobCall!.jobType,
      connectionId: shopJobCall!.connectionId,
      payload: shopJobCall!.payload,
      idempotencyKey: shopJobCall!.idempotencyKey,
      maxAttempts: 10,
      runAfter: new Date(),
    });

    const updateHandler = harness.get<MarketplaceOfferQuantityUpdateHandler>(
      MarketplaceOfferQuantityUpdateHandler,
    );
    const result = await updateHandler.execute(persistedJob);

    expect(result.outcome).toBe('ok');
    const puts = wc.fake.callsOf('PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].path).toBe(`/wp-json/wc/v3/products/${externalWcProductId}`);
    expect(puts[0].body).toEqual({ manage_stock: true, stock_quantity: 17 });
  });

  it('excludes a connection that is also the InventoryMaster from stock write-back (authority guard, #1498)', async () => {
    const connection = await createTestConnection(dataSource, {
      platformType: wc.platformType,
      status: 'active',
      credentialsRef: 'test-credentials-ref',
      adapterKey: wc.adapterKey,
      // Seeded directly in the DB to model an already-conflicted connection —
      // ConnectionService.assertNoWriteBackAuthorityConflict blocks this
      // combination at the API layer; this spec asserts the independent
      // runtime authority guard in the fan-out handler itself.
      enabledCapabilities: ['OfferManager', 'InventoryMaster'],
    });

    const productId = `ol_product_${randomUUID().replace(/-/g, '')}`;
    const variantId = `ol_variant_${randomUUID().replace(/-/g, '')}`;
    await identifierMapping.createMapping(
      CORE_ENTITY_TYPE.ShopProduct,
      '9999',
      connection.id,
      variantId,
    );

    const enqueueSpy = jest.spyOn(jobEnqueue, 'enqueueJob');

    await seedAndPropagate(productId, variantId, 5);

    const shopJobCall = enqueueSpy.mock.calls
      .map(([request]) => request)
      .find((request) => request.connectionId === connection.id);
    expect(shopJobCall).toBeUndefined();
    expect(wc.fake.calls).toHaveLength(0);
  });
});
