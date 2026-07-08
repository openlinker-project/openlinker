/**
 * Erli Stock-Restore-on-Cancellation Smoke Tests (#997 / #1146)
 *
 * Exercises the end-to-end cancel → stock-restore path through the REAL
 * `ErliOfferManagerAdapter` (wired to a fake `IErliHttpClient`), the production
 * adapter-resolution seam (`IntegrationsService.getCapabilityAdapter`), the REAL
 * `OfferStockRestoreService`, and real Postgres + Redis via Testcontainers.
 *
 * Faking at the HTTP-transport seam keeps every production layer — offer-mapping
 * lookup, master-inventory resolution, `OfferStockRestorer` dispatch, and the
 * absolute-set PATCH — under test without reaching a real Erli API.
 *
 * Scope: four golden paths — happy path, missing offer mapping, snapshot without
 * variantId, and master-stock-0 authoritativeness. Not repeated: unit cases
 * already covered in `offer-stock-restore.service.spec.ts` (frozen-stock cache,
 * capability-first short-circuit, multi-destination fan-out).
 *
 * @module apps/api/test/integration/erli
 */
import { randomUUID } from 'crypto';
import type { DataSource } from 'typeorm';
import { encryptWithKey, loadEncryptionKey } from '@openlinker/shared';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { IntegrationCredentialOrmEntity } from '@openlinker/core/integrations/orm-entities';
import { OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import {
  OFFER_STOCK_RESTORE_SERVICE_TOKEN,
  type IOfferStockRestoreService,
} from '@openlinker/core/listings';

import type { IntegrationTestHarness } from '../setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import {
  ERLI_TEST_ADAPTER_KEY,
  ERLI_TEST_PLATFORM_TYPE,
  installErliOffersHarness,
  type ErliOffersHarness,
} from '../helpers/erli-test-offer-manager.helper';

// Fixed external Erli product ID (the PATCH path key). Must pass
// ERLI_PRODUCT_ID_PATTERN (/^ol_variant_[a-f0-9]{32}$/). Constant across all
// tests — no uniqueness constraint on identifier_mappings.externalId alone
// (it's scoped by connectionId which is fresh per test).
const ERLI_PRODUCT_ID = 'ol_variant_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/** Path the adapter PATCHes for a given Erli product id. */
function stockPatchPath(offerId: string): string {
  return `products/${encodeURIComponent(offerId)}`;
}

describe('Erli Stock-Restore-on-Cancellation Smoke Tests (#997/#1146)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let erli: ErliOffersHarness;
  let connectionId: string;
  // Fresh per test: PK in product_variants, so must not repeat across cases.
  let internalVariantId: string;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    erli = installErliOffersHarness(harness);
  });

  afterEach(async () => {
    erli.fake.reset();
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    connectionId = await seedErliConnection(dataSource);
    // UUID without dashes = 32 lowercase hex chars → valid ERLI_PRODUCT_ID_PATTERN.
    internalVariantId = `ol_variant_${randomUUID().replace(/-/g, '')}`;
  });

  function restoreService(): IOfferStockRestoreService {
    return harness.getApp().get<IOfferStockRestoreService>(OFFER_STOCK_RESTORE_SERVICE_TOKEN);
  }

  // ── S1: happy path ────────────────────────────────────────────────────────
  it('S1: PATCH carries the absolute master stock when all data is in place', async () => {
    const internalOrderId = `ol_order_${randomUUID().replace(/-/g, '')}`;
    await seedProductAndVariant(internalVariantId);
    await seedOfferMapping(ERLI_PRODUCT_ID, internalVariantId);
    await seedInventoryItem(internalVariantId, 5);
    await seedOrderRecord(internalOrderId, connectionId, [internalVariantId]);

    await restoreService().restoreStockForCancelledOrder(connectionId, internalOrderId);

    const patches = erli.fake.callsOf('PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].path).toBe(stockPatchPath(ERLI_PRODUCT_ID));
    expect(patches[0].body).toEqual({ stock: 5 });
  });

  // ── S2: no offer mapping → silent no-op ───────────────────────────────────
  it('S2: no offer mapping in identifier_mappings → no PATCH sent', async () => {
    const internalOrderId = `ol_order_${randomUUID().replace(/-/g, '')}`;
    await seedProductAndVariant(internalVariantId);
    // Deliberately skip seedOfferMapping: the variant has no Erli offer mapping.
    await seedInventoryItem(internalVariantId, 5);
    await seedOrderRecord(internalOrderId, connectionId, [internalVariantId]);

    await restoreService().restoreStockForCancelledOrder(connectionId, internalOrderId);

    expect(erli.fake.callsOf('PATCH')).toHaveLength(0);
  });

  // ── S3: snapshot without variantId (awaiting_mapping shape) → no-op ───────
  it('S3: order snapshot with items lacking variantId → no PATCH sent', async () => {
    const internalOrderId = `ol_order_${randomUUID().replace(/-/g, '')}`;
    // Empty variantIds list produces items: [] in the snapshot — collectVariantIds
    // returns [] and the service short-circuits before the offer-mapping lookup.
    await seedOrderRecord(internalOrderId, connectionId, []);

    await restoreService().restoreStockForCancelledOrder(connectionId, internalOrderId);

    expect(erli.fake.callsOf('PATCH')).toHaveLength(0);
  });

  // ── S4: master stock = 0 is authoritative ─────────────────────────────────
  it('S4: master inventory = 0 → PATCH sends stock=0 (not backfilled, not skipped)', async () => {
    const internalOrderId = `ol_order_${randomUUID().replace(/-/g, '')}`;
    await seedProductAndVariant(internalVariantId);
    await seedOfferMapping(ERLI_PRODUCT_ID, internalVariantId);
    await seedInventoryItem(internalVariantId, 0);
    await seedOrderRecord(internalOrderId, connectionId, [internalVariantId]);

    await restoreService().restoreStockForCancelledOrder(connectionId, internalOrderId);

    const patches = erli.fake.callsOf('PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toEqual({ stock: 0 });
  });

  // ── Seed helpers ──────────────────────────────────────────────────────────

  async function seedProductAndVariant(variantId: string): Promise<void> {
    const productId = `ol_product_${randomUUID().replace(/-/g, '')}`;
    await dataSource.query(
      `INSERT INTO products (id, name, "createdAt", "updatedAt") VALUES ($1, $2, now(), now())`,
      [productId, 'Smoke Test Product'],
    );
    await dataSource.query(
      `INSERT INTO product_variants (id, "productId", attributes, "createdAt", "updatedAt")
       VALUES ($1, $2, $3::jsonb, now(), now())`,
      [variantId, productId, JSON.stringify({})],
    );
  }

  async function seedOfferMapping(externalId: string, internalId: string): Promise<void> {
    // OfferMappingRepository queries identifier_mappings with entityType='Offer',
    // filter internalId=variantId, returns externalId as the Erli product path key.
    const identifierMappingService = harness
      .getApp()
      .get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);
    await identifierMappingService.createMapping(
      CORE_ENTITY_TYPE.Offer,
      externalId,
      connectionId,
      internalId,
    );
  }

  async function seedInventoryItem(variantId: string, availableQuantity: number): Promise<void> {
    // Resolve the productId FK from the already-seeded product_variants row.
    const [row] = await dataSource.query<{ productId: string }[]>(
      `SELECT "productId" FROM product_variants WHERE id = $1`,
      [variantId],
    );
    const itemId = `ol_inventoryitem_${randomUUID().replace(/-/g, '')}`;
    await dataSource.query(
      `INSERT INTO inventory_items
         (id, "productId", "productVariantId", "availableQuantity", "reservedQuantity", "updatedAt")
       VALUES ($1, $2, $3, $4, 0, now())`,
      [itemId, row.productId, variantId, availableQuantity],
    );
  }

  /**
   * Seed an order_records row whose snapshot carries items with the given
   * variantIds. An empty variantIds array produces an items: [] snapshot —
   * collectVariantIds returns [] and the restore no-ops (S3). Each item carries
   * a minimal shape; the restore service reads only variantId.
   */
  async function seedOrderRecord(
    internalOrderId: string,
    sourceConnectionId: string,
    variantIds: string[],
  ): Promise<void> {
    const items = variantIds.map((variantId) => ({
      variantId,
      quantity: 1,
      unitPrice: { amount: 49.99, currency: 'PLN' },
    }));
    const repo = dataSource.getRepository(OrderRecordOrmEntity);
    await repo.save(
      repo.create({
        internalOrderId,
        sourceConnectionId,
        orderSnapshot: { items },
      }),
    );
  }
});

/**
 * Seed an active Erli connection wired to the test OfferManager adapterKey +
 * an obviously-fake credential row. Mirrors the pattern from
 * `erli-offers-vertical-slice.int-spec.ts` — fresh connectionId per test so
 * identifier_mappings unique constraint `(entityType, platformType, connectionId,
 * externalId)` never conflicts across tests even with a fixed ERLI_PRODUCT_ID.
 */
async function seedErliConnection(dataSource: DataSource): Promise<string> {
  const credentialsRef = `test-erli-smoke-${randomUUID()}`;
  const { key } = loadEncryptionKey(process.env);
  const credRepo = dataSource.getRepository(IntegrationCredentialOrmEntity);
  await credRepo.save(
    credRepo.create({
      ref: credentialsRef,
      platformType: ERLI_TEST_PLATFORM_TYPE,
      credentialsCiphertext: encryptWithKey(
        key,
        JSON.stringify({ apiKey: 'test-erli-key-not-real' }),
      ),
    }),
  );
  const connRepo = dataSource.getRepository(ConnectionOrmEntity);
  const connection = await connRepo.save(
    connRepo.create({
      platformType: ERLI_TEST_PLATFORM_TYPE,
      name: 'Test Erli smoke connection',
      status: 'active',
      config: {},
      credentialsRef: `db:${credentialsRef}`,
      adapterKey: ERLI_TEST_ADAPTER_KEY,
      enabledCapabilities: ['OfferManager'],
    }),
  );
  return connection.id;
}
