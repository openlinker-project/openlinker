/**
 * WooCommerce Bulk-Listing Wizard Smoke Int-Spec (#878)
 *
 * Verifies the OL bulk-listing wizard works end-to-end against a real
 * WooCommerce Testcontainer:
 *
 *   S-1 — simple product offer creation:
 *     Sync WC catalog → submit bulk wizard → drain batch → assert batch
 *     completed with 0 failures.
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
import { getTestHarness, resetTestHarness, type IntegrationTestHarness } from '../setup';
import {
  startWooCommerceContainer,
  type WooCommerceTestContainer,
} from '../helpers/woocommerce-container.helper';
import { createTestWooCommerceConnection } from '../helpers/woocommerce-connection.helper';
import { drainProductSyncJobs } from '../helpers/woocommerce-sync.helper';
import { drainBulkBatch } from '../helpers/bulk-batch-drain.helper';
import {
  installAllegroTestOfferManagerStub,
  type AllegroTestOfferManagerStub,
} from '../helpers/allegro-test-offer-manager-stub.helper';
// loginAsAdmin creates a test user + returns a valid Bearer token using the
// established integration-test auth pattern (bcrypt + POST /auth/login).
import { loginAsAdmin } from '../helpers/test-auth.helper';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';

// Skip automatically on CI (GitHub Actions sets CI=true) or when
// OL_SKIP_WC_INTEGRATION=true. These boot a real WordPress + auto-install
// WooCommerce per spec (~12 min cold), which exceeds the PR integration step's
// timeout — run them locally (with Docker) or in a dedicated longer-timeout job.
const SKIP_WC_INTEGRATION =
  process.env.CI === 'true' || process.env.OL_SKIP_WC_INTEGRATION === 'true';

(SKIP_WC_INTEGRATION ? describe.skip : describe)('WooCommerce bulk-listing wizard smoke (#878)', () => {
  let harness: IntegrationTestHarness;
  let wc: WooCommerceTestContainer;
  let wcConnectionId: string;
  let allegroConnectionId: string;
  let shirtVariantInternalId: string;
  let jeansSVariantInternalId: string;
  let jeansMVariantInternalId: string;
  let authToken: string;
  let stub: AllegroTestOfferManagerStub;

  beforeAll(async () => {
    harness = await getTestHarness();
    wc = await startWooCommerceContainer();

    // Register stub Allegro OfferManager + OfferCreator (suite-scoped — registers
    // the stub in the NestJS DI graph once; remains in place for all tests).
    stub = installAllegroTestOfferManagerStub(harness);
  }, 20 * 60_000); // 20 min: WC boot

  beforeEach(async () => {
    // Re-create all DB-side fixtures after each resetTestHarness() call which
    // truncates connections, identifier_mappings, users, etc.
    // The WC Testcontainer keeps running between tests — only the OL DB is reset.

    // Seed test admin user and obtain Bearer token.
    // loginAsAdmin inserts the user into the test DB with bcrypt-hashed password
    // and returns the JWT from POST /auth/login — same path as production auth.
    authToken = await loginAsAdmin(harness.getHttp(), harness.getDataSource());

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
        config: { masterCatalogConnectionId: wcConnectionId },
        credentialsRef: 'env:ALLEGRO_CLIENT_ID',
        adapterKey: 'allegro.test.offer-manager.v1',
        enabledCapabilities: ['OfferManager'],
      }),
    );
    allegroConnectionId = allegroConn.id;

    // Populate identifier mappings via adapter path (mandatory before bulk submit)
    await drainProductSyncJobs(harness, wcConnectionId, [
      wc.simpleProductExternalId,
      wc.variableProductExternalId,
    ]);

    // Resolve internal variant IDs from identifier_mappings table.
    // Direct DataSource query is acceptable in test setup — not production logic.
    // Confirmed pattern: order-destination-retry.int-spec.ts:67 uses the same approach.
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

    // M-variation: variationIds[1] = M-variation WC external id
    jeansMVariantInternalId = await findVariantInternalId(wc.variationIds[1]);

    // Pre-script success results for all variants in the stub adapter.
    // The drain helper calls createOffer per pending record; the stub throws if
    // no script is set. Reset clears scripts from previous test runs.
    stub.reset();
    stub.setNextCreateResult(shirtVariantInternalId, {
      kind: 'success',
      externalOfferId: 'ext-shirt-001',
      status: 'active',
    });
    stub.setNextCreateResult(jeansSVariantInternalId, {
      kind: 'success',
      externalOfferId: 'ext-jeans-s-001',
      status: 'active',
    });
    stub.setNextCreateResult(jeansMVariantInternalId, {
      kind: 'success',
      externalOfferId: 'ext-jeans-m-001',
      status: 'active',
    });
  });

  afterEach(async () => {
    // Truncate OL DB tables between S-1 and S-2 so each test starts with a
    // clean OL DB. Per testing guide §Integration Tests best practices item 5.
    await resetTestHarness();
  });

  afterAll(async () => {
    await wc.cleanup();
  });

  it('S-1: should create Allegro offer from WC simple product via bulk wizard', async () => {
    const http = harness.getHttp();

    // POST /listings/bulk-create — returns 202 ACCEPTED per the controller spec.
    // connectionId = Allegro destination; productIds = OL internal variant IDs.
    const submitRes = await http
      .post('/v1/listings/bulk-create')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        connectionId: allegroConnectionId,
        productIds: [shirtVariantInternalId],
        sharedConfig: {
          stock: 10,
          publishImmediately: false,
          price: { amount: 49.99, currency: 'PLN' },
          overrides: { categoryId: 'test-category-001' },
        },
      })
      .expect(202);

    const batchId: string = submitRes.body.batchId as string;
    expect(batchId).toBeDefined();

    const result = await drainBulkBatch(harness, batchId);

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].outcome).toBe('ok');
  });

  it('S-2: variable product expands to 2 offers (S + M fan-out via #824)', async () => {
    const http = harness.getHttp();

    // Submit the S variant as the primary; the submit service expands it to
    // both S and M offers (multi-variant fan-out, #824). totalCount = 2.
    const submitRes = await http
      .post('/v1/listings/bulk-create')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        connectionId: allegroConnectionId,
        productIds: [jeansSVariantInternalId],
        sharedConfig: {
          stock: 10,
          publishImmediately: false,
          price: { amount: 79.99, currency: 'PLN' },
          overrides: { categoryId: 'test-category-001' },
        },
      })
      .expect(202);

    const batchId: string = submitRes.body.batchId as string;

    const result = await drainBulkBatch(harness, batchId);

    // Both S and M variant mappings were created by drainProductSyncJobs,
    // so the fan-out resolves both variants (multi-variant expansion #824).
    expect(result.outcomes).toHaveLength(2);
    result.outcomes.forEach((o) => expect(o.outcome).toBe('ok'));
  });
});
