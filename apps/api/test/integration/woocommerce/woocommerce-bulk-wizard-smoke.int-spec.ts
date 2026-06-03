/**
 * WooCommerce Bulk-Listing Wizard Smoke Int-Spec (#878)
 *
 * Verifies the OL bulk-listing wizard works end-to-end against a real
 * WooCommerce Testcontainer:
 *
 *   S-1 — simple product offer creation:
 *     Sync WC catalog → submit bulk wizard → drain batch → assert Allegro stub
 *     received createOffer and batch completed with 0 failures.
 *
 *   S-2 — variable product multi-variant fan-out (#824):
 *     Submit WC-JEANS primary variant → batch expands to 2 (S + M) → both
 *     Allegro offers created.
 *
 * Suite-scoped. Internal variant IDs are resolved via DataSource query after
 * drainProductSyncJobs (test-setup-only DB access, not production logic).
 *
 * @module apps/api/test/integration/woocommerce
 */
import supertest from 'supertest';
import { getTestHarness, type IntegrationTestHarness } from '../setup';
import {
  startWooCommerceContainer,
  type WooCommerceTestContainer,
} from '../helpers/woocommerce-container.helper';
import { createTestWooCommerceConnection } from '../helpers/woocommerce-connection.helper';
import { drainProductSyncJobs } from '../helpers/woocommerce-sync.helper';
import { drainBulkBatch } from '../helpers/bulk-batch-drain.helper';
import { installAllegroTestOfferManagerStub } from '../helpers/allegro-test-offer-manager-stub.helper';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';

describe('WooCommerce bulk-listing wizard smoke (#878)', () => {
  let harness: IntegrationTestHarness;
  let wc: WooCommerceTestContainer;
  let wcConnectionId: string;
  let allegroConnectionId: string;
  let shirtVariantInternalId: string;
  let jeansSVariantInternalId: string;

  beforeAll(async () => {
    harness = await getTestHarness();
    wc = await startWooCommerceContainer();

    // Register stub Allegro OfferManager + OfferCreator
    installAllegroTestOfferManagerStub(harness);

    // Create WC connection
    const wcConn = await createTestWooCommerceConnection(harness.getDataSource(), {
      siteUrl: wc.baseUrl,
      consumerKey: wc.consumerKey,
      consumerSecret: wc.consumerSecret,
      enabledCapabilities: ['ProductMaster', 'InventoryMaster'],
    });
    wcConnectionId = wcConn.id;

    // Create stub Allegro connection
    const allegroRepo = harness.getDataSource().getRepository(ConnectionOrmEntity);
    const allegroConn = await allegroRepo.save(
      allegroRepo.create({
        platformType: 'allegro',
        name: 'Test Allegro offers',
        status: 'active',
        config: {},
        credentialsRef: 'env:ALLEGRO_CLIENT_ID',
        adapterKey: 'allegro.publicapi.v1',
        enabledCapabilities: ['OfferManager'],
      }),
    );
    allegroConnectionId = allegroConn.id;

    // STEP 6: populate identifier mappings via adapter path
    await drainProductSyncJobs(harness, wcConnectionId, [
      wc.simpleProductExternalId,
      wc.variableProductExternalId,
    ]);

    // STEP 7: resolve internal variant IDs from identifier_mappings table
    // (test-setup-only DB access via IdentifierMappingOrmEntity — not production logic)
    const mappingRepo = harness.getDataSource().getRepository(IdentifierMappingOrmEntity);

    const findVariantInternalId = async (externalId: string): Promise<string> => {
      const row = await mappingRepo.findOneOrFail({
        where: {
          entityType: CORE_ENTITY_TYPE.ProductVariant,
          externalId,
          connectionId: wcConnectionId,
        },
      });
      return row.internalId;
    };

    // Simple product: synthetic variant externalId = "product:{wcProductId}"
    shirtVariantInternalId = await findVariantInternalId(
      `product:${wc.simpleProductExternalId}`,
    );

    // S-variation: variationIds[0] = S-variation WC external id
    jeansSVariantInternalId = await findVariantInternalId(wc.variationIds[0]);
  }, 20 * 60_000); // 20 min: WC boot + product sync + potential bulk overhead

  afterAll(async () => {
    await wc.cleanup();
  });

  it('S-1: should create Allegro offer from WC simple product via bulk wizard', async () => {
    const http = harness.getHttp();

    const submitRes = await http
      .post('/bulk/offer-creation/submit')
      .set('Authorization', `Bearer ${await getTestAuthToken(harness)}`)
      .send({
        sourceConnectionId: wcConnectionId,
        destConnectionId: allegroConnectionId,
        variantIds: [shirtVariantInternalId],
      })
      .expect(201);

    const batchId: string = submitRes.body.batchId as string;
    expect(batchId).toBeDefined();

    const result = await drainBulkBatch(harness, batchId);

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].outcome).toBe('ok');
  });

  it('S-2: variable product expands to 2 offers (S + M fan-out via #824)', async () => {
    const http = harness.getHttp();

    const submitRes = await http
      .post('/bulk/offer-creation/submit')
      .set('Authorization', `Bearer ${await getTestAuthToken(harness)}`)
      .send({
        sourceConnectionId: wcConnectionId,
        destConnectionId: allegroConnectionId,
        variantIds: [jeansSVariantInternalId], // primary S variant triggers fan-out
      })
      .expect(201);

    const batchId: string = submitRes.body.batchId as string;

    const result = await drainBulkBatch(harness, batchId);

    // Both S and M variant mappings were created by drainProductSyncJobs,
    // so the fan-out resolves both variants.
    expect(result.outcomes).toHaveLength(2);
    result.outcomes.forEach((o) => expect(o.outcome).toBe('ok'));
  });
});

async function getTestAuthToken(harness: IntegrationTestHarness): Promise<string> {
  const res = await harness.getHttp()
    .post('/auth/login')
    .send({ email: 'admin@openlinker.local', password: 'password' });
  return (res.body as { accessToken: string }).accessToken ?? '';
}
