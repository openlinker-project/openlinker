/**
 * Price-basis correction - master sync to detection, against real Postgres
 * (#3737, ADR-077)
 *
 * ADR-077 makes every catalogue price gross. The migration flags each priced
 * variant of a PrestaShop/WooCommerce master with `priceBasisPending`, and the
 * first sync that moves its price must open a `'tax-basis-correction'` episode
 * that is NEVER auto-applied - even on a pair set to automatic price sync - and
 * then clear the flag. Each half lives in a different place (the master sync
 * reads the flag, the detector withholds the apply, the variant repository
 * clears it), so only a run through all three against real tables proves they
 * agree.
 *
 * Seam: the API host deliberately binds no price-change observer (see
 * `price-change-observer-binding-boot.int-spec.ts`), so the container's own
 * `MasterProductSyncService` would never call the detector. This spec builds one
 * with the REAL products service, identifier mapping and price-change detector
 * from the container, stubbing only the platform adapter (the master shop), the
 * rival-claim check, the event publisher and the tax-rate journal - none of
 * which this flow exercises. The automatic-apply enqueue is spied on the
 * detector's own `JobEnqueuePort` so the assertion reads the instance the
 * detector actually calls.
 *
 * @module apps/api/test/integration
 */
import {
  MasterProductSyncService,
  PRODUCTS_SERVICE_TOKEN,
  type IProductsService,
  type ITaxRateJournalService,
  type Product,
  type ProductMasterPort,
  type ProductVariant,
} from '@openlinker/core/products';
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import type { IEntityClaimService, IIntegrationsService } from '@openlinker/core/integrations';
import type { EventPublisherPort } from '@openlinker/core/events';
import type { JobEnqueuePort } from '@openlinker/core/sync';
import {
  PRICE_CHANGE_DETECTION_SERVICE_TOKEN,
  type IPriceChangeDetectionService,
} from '@openlinker/core/listings';

import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';

const EXTERNAL_PRODUCT_ID = 'ps-product-3737';
const VARIANT_ID = 'ol_variant_basis_3737';
const SKU = 'SKU-BASIS-3737';

interface EpisodeRow {
  id: string;
  cause: string | null;
  blockReason: string | null;
  resolvedAt: Date | null;
  sourceOldAmount: string | null;
  sourceNewAmount: string;
}

interface VariantRow {
  price: string | null;
  priceBasisPending: boolean;
}

describe('Price-basis correction through the master sync (#3737, ADR-077)', () => {
  let harness: IntegrationTestHarness;
  let productsService: IProductsService;
  let identifierMapping: IIdentifierMappingService;
  let detection: IPriceChangeDetectionService;
  let enqueueSpy: jest.SpyInstance;

  beforeAll(async () => {
    harness = await getTestHarness();
    const app = harness.getApp();
    productsService = app.get<IProductsService>(PRODUCTS_SERVICE_TOKEN, { strict: false });
    identifierMapping = app.get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN, {
      strict: false,
    });
    detection = app.get<IPriceChangeDetectionService>(PRICE_CHANGE_DETECTION_SERVICE_TOKEN, {
      strict: false,
    });
  });

  beforeEach(() => {
    // The detector's own instance, so a call is observed exactly where it is
    // made. Resolved, never forwarded: whether the real queue accepts the job
    // is not this spec's subject.
    const jobEnqueue = (detection as unknown as { jobEnqueue: JobEnqueuePort }).jobEnqueue;
    enqueueSpy = jest
      .spyOn(jobEnqueue, 'enqueueJob')
      .mockResolvedValue({ jobId: 'job-basis-1', isExisting: false });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  /** A master that reports `price` gross for the product and its one variant; `null` = no gross price. */
  function masterReporting(price: number | null): ProductMasterPort {
    const product = (productId: string): Product => ({
      id: productId,
      name: 'Basis chair',
      sku: SKU,
      price,
      description: null,
      images: null,
      currency: 'PLN',
    });
    const variant = (productId: string): ProductVariant => ({
      id: VARIANT_ID,
      productId,
      sku: SKU,
      attributes: null,
      ean: null,
      gtin: null,
      ...(price === null ? {} : { price }),
    });
    return {
      getProduct: (productId: string) => Promise.resolve(product(productId)),
      getProductVariants: (productId: string) => Promise.resolve([variant(productId)]),
    } as unknown as ProductMasterPort;
  }

  function buildSync(adapter: ProductMasterPort): MasterProductSyncService {
    const integrations = {
      getCapabilityAdapter: () => Promise.resolve(adapter),
    } as unknown as IIntegrationsService;
    const eventPublisher = {
      publish: () => Promise.resolve('msg-basis-1'),
    } as unknown as EventPublisherPort;
    // This connection is the only ProductMaster, so the prune guard never fires.
    const entityClaims = {
      findRivalClaimants: () => Promise.resolve([]),
    } as unknown as IEntityClaimService;
    // The stub master reads no tax rate, so the journal is never written.
    const taxRateJournal = {
      record: () => Promise.resolve(null),
      getLatestPerConnection: () => Promise.resolve([]),
    } as unknown as ITaxRateJournalService;

    return new MasterProductSyncService(
      integrations,
      identifierMapping,
      productsService,
      eventPublisher,
      entityClaims,
      taxRateJournal,
      detection
    );
  }

  /**
   * A PrestaShop master whose variant was synced at the old NET price 100, an
   * Allegro offer mapped to that variant on an AUTOMATIC pair, and - when
   * `basisPending` - the flag the ADR-077 migration sets on such a variant.
   */
  async function seedCatalogue(basisPending: boolean): Promise<{ masterId: string }> {
    const dataSource = harness.getDataSource();
    const master = await createTestConnection(dataSource, {
      name: 'PrestaShop master',
      enabledCapabilities: ['ProductMaster'],
    });
    const destination = await createTestConnection(dataSource, {
      platformType: 'allegro',
      adapterKey: 'allegro.publicapi.v1',
      name: 'Allegro destination',
      // A known destination currency equal to the source's, so no blockReason
      // can be what withholds the apply - only the cause may.
      config: { currency: 'PLN', priceSyncMode: { default: 'automatic', sourceOverrides: {} } },
    });

    const internalProductId = await identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.Product,
      EXTERNAL_PRODUCT_ID,
      master.id
    );
    await productsService.upsertProduct({
      id: internalProductId,
      name: 'Basis chair',
      sku: SKU,
      price: 100,
      description: null,
      images: null,
      currency: 'PLN',
    });
    await productsService.upsertVariants(internalProductId, [
      {
        id: VARIANT_ID,
        productId: internalProductId,
        sku: SKU,
        attributes: null,
        ean: null,
        gtin: null,
        price: 100,
      },
    ]);
    if (basisPending) {
      // Exactly what the migration's backfill writes; the upsert above cleared
      // it, being a priced write.
      await dataSource.query(
        `UPDATE "product_variants" SET "priceBasisPending" = true WHERE "id" = $1`,
        [VARIANT_ID]
      );
    }
    await identifierMapping.createMapping(
      CORE_ENTITY_TYPE.Offer,
      'allegro-offer-basis-3737',
      destination.id,
      VARIANT_ID
    );

    return { masterId: master.id };
  }

  async function readEpisodes(): Promise<EpisodeRow[]> {
    return harness.getDataSource().query(
      `SELECT "id", "cause", "blockReason", "resolvedAt", "sourceOldAmount", "sourceNewAmount"
         FROM "price_change_episodes"
        WHERE "productVariantId" = $1`,
      [VARIANT_ID]
    );
  }

  async function readVariant(): Promise<VariantRow> {
    const rows: VariantRow[] = await harness
      .getDataSource()
      .query(`SELECT "price", "priceBasisPending" FROM "product_variants" WHERE "id" = $1`, [
        VARIANT_ID,
      ]);
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  it('should open an unapplied tax-basis-correction episode and clear the flag when a pending variant moves to gross on an automatic pair', async () => {
    const { masterId } = await seedCatalogue(true);
    expect((await readVariant()).priceBasisPending).toBe(true);

    const result = await buildSync(masterReporting(123)).syncFromMasterByExternalId(
      masterId,
      EXTERNAL_PRODUCT_ID
    );

    expect(result.priceChangeObserverFailures).toBe(0);

    const episodes = await readEpisodes();
    expect(episodes).toHaveLength(1);
    expect(episodes[0].cause).toBe('tax-basis-correction');
    // Open and unblocked: the operator approves it in the review queue.
    expect(episodes[0].resolvedAt).toBeNull();
    expect(episodes[0].blockReason).toBeNull();
    expect(Number(episodes[0].sourceOldAmount)).toBe(100);
    expect(Number(episodes[0].sourceNewAmount)).toBe(123);

    // Never auto-applied, although the pair is automatic and nothing blocks it.
    expect(enqueueSpy).not.toHaveBeenCalled();

    // Reporting the correction ended the window for this variant.
    const variant = await readVariant();
    expect(variant.priceBasisPending).toBe(false);
    expect(Number(variant.price)).toBe(123);
  });

  it('should auto-apply an ordinary price move on the same automatic pair when the variant is not pending', async () => {
    const { masterId } = await seedCatalogue(false);

    await buildSync(masterReporting(123)).syncFromMasterByExternalId(masterId, EXTERNAL_PRODUCT_ID);

    const episodes = await readEpisodes();
    expect(episodes).toHaveLength(1);
    expect(episodes[0].cause).toBeNull();

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'pricing.propagateToMarketplaces',
        payload: expect.objectContaining({ episodeId: episodes[0].id, automatic: true }),
      })
    );
  });

  it('should keep the flag across a sync with no gross price and stamp the correction on the first priced sync', async () => {
    const { masterId } = await seedCatalogue(true);

    // The master cannot state a gross price yet (e.g. an unresolvable tax
    // setup): nothing is reported and the variant stays pending.
    await buildSync(masterReporting(null)).syncFromMasterByExternalId(
      masterId,
      EXTERNAL_PRODUCT_ID
    );

    expect(await readEpisodes()).toHaveLength(0);
    const pending = await readVariant();
    expect(pending.priceBasisPending).toBe(true);
    expect(pending.price).toBeNull();

    await buildSync(masterReporting(123)).syncFromMasterByExternalId(masterId, EXTERNAL_PRODUCT_ID);

    const episodes = await readEpisodes();
    expect(episodes).toHaveLength(1);
    expect(episodes[0].cause).toBe('tax-basis-correction');
    // The stored price was cleared by the price-less sync, so there is no old
    // amount to report - never a fabricated one.
    expect(episodes[0].sourceOldAmount).toBeNull();
    expect(Number(episodes[0].sourceNewAmount)).toBe(123);
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect((await readVariant()).priceBasisPending).toBe(false);
  });
});
