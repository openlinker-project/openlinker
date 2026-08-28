/**
 * Diagnostic holds have no operator-visible consequence (#2628 review)
 *
 * The acceptance test for the BLOCKING finding: **on a default install, no false
 * shortfall episode may open and no legitimate order may be refused, however
 * long the install runs.**
 *
 * ## The shape being reproduced
 *
 * `omp_fulfilled` is the DEFAULT fulfilment topology, and on it the marketplace
 * ships — so OpenLinker creates no `Shipment`, and neither of `closeForOrder`'s
 * two production callers ever fires for a normally-fulfilled, never-cancelled
 * order. The third closer, the expiry sweep, releases nothing while
 * `UnavailableOrderHoldReader` is bound. `inventory_items.olReservedQuantity`
 * therefore climbs monotonically for the life of the install.
 *
 * That is tolerable ONLY because every reader of the counter is `atpEffect`
 * scoped. Before the fix, two shipped readers were not, and both degraded on a
 * perfectly healthy catalogue:
 *
 *  - the shortfall reconciler compared the counter to `availableQuantity`, so it
 *    opened a permanent "stock at risk" episode naming a real order;
 *  - the admission guard subtracted the counter, so past the stock level every
 *    reserve raised `InsufficientAvailabilityError` — swallowed by
 *    `reserveOrderInventory`, leaving the order invisible to BOTH the ledger and
 *    shortfall detection.
 *
 * This spec drives the REAL write path (`claimHeld`) and the REAL reconciler
 * against real Postgres, because the claim is about a `WHERE` predicate and a
 * correlated sub-select, which no mock can settle.
 *
 * The `published` counterparts are asserted alongside deliberately: a test that
 * only shows "nothing happens" would pass just as well against a reconciler that
 * detects nothing at all, or a guard that refuses nothing at all.
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';
import {
  ProductOrmEntity,
  ProductVariantOrmEntity,
} from '@openlinker/core/products/orm-entities';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';
import {
  InsufficientAvailabilityError,
  RESERVATION_REPOSITORY_TOKEN,
  RESERVATION_SHORTFALL_SERVICE_TOKEN,
  type IReservationShortfallService,
  type ReservationClaimInput,
  type ReservationClaimOutcome,
} from '@openlinker/core/inventory';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

/**
 * The one method this spec needs, declared locally for the reason
 * `reservations-ledger.int-spec.ts` states at length: a `*RepositoryPort` is an
 * intra-context contract that `check-cross-context-imports.mjs` deliberately
 * denies to `apps/api`, and binding to the shape keeps that rule intact while
 * every argument and return type stays the real one.
 */
interface ReservationLedger {
  claimHeld(claims: readonly ReservationClaimInput[]): Promise<readonly ReservationClaimOutcome[]>;
}

const EXPIRES_AT = new Date('2027-01-01T00:00:00.000Z');
const RUN = { detectLimit: 100, closeLimit: 100, detectOffset: 0, closeOffset: 0 };

/** Stock on the position. Every accumulated hold below is larger than this. */
const STOCK = 10;

interface SeededPosition {
  inventoryItemId: string;
  productId: string;
  variantId: string;
}

async function seedPosition(
  dataSource: DataSource,
  availableQuantity: number
): Promise<SeededPosition> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const productId = `ol_product_diag_${suffix}`;
  const variantId = `ol_variant_diag_${suffix}`;
  const inventoryItemId = `ol_inventoryitem_diag_${suffix}`;

  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({ id: productId, name: `Diag ${suffix}`, sku: null, price: null })
  );

  const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
  await variantRepo.save(
    variantRepo.create({
      id: variantId,
      productId,
      sku: `SKU-DIAG-${suffix}`,
      attributes: null,
      ean: null,
      gtin: null,
    })
  );

  const itemRepo = dataSource.getRepository(InventoryItemOrmEntity);
  await itemRepo.save(
    itemRepo.create({
      id: inventoryItemId,
      productId,
      productVariantId: variantId,
      availableQuantity,
      reservedQuantity: 0,
      olReservedQuantity: 0,
      locationId: null,
      sourceConnectionId: 'conn-diag-test',
      isStale: false,
    })
  );

  return { inventoryItemId, productId, variantId };
}

async function readCounter(dataSource: DataSource, inventoryItemId: string): Promise<number> {
  const rows = (await dataSource.query(
    `SELECT "olReservedQuantity" FROM "inventory_items" WHERE "id" = $1`,
    [inventoryItemId]
  )) as { olReservedQuantity: number | string }[];
  return Number(rows[0]?.olReservedQuantity ?? -1);
}

async function countEpisodes(
  dataSource: DataSource,
  inventoryItemId: string
): Promise<number> {
  const rows = (await dataSource.query(
    `SELECT COUNT(*)::int AS "n" FROM "reservation_shortfall_episodes"
      WHERE "inventoryItemId" = $1`,
    [inventoryItemId]
  )) as { n: number }[];
  return Number(rows[0]?.n ?? -1);
}

function claim(
  overrides: Partial<ReservationClaimInput> & { inventoryItemId: string }
): ReservationClaimInput {
  return {
    orderRecordId: 'ol_order_diag',
    orderLineId: 'line-1',
    quantity: 1,
    atpEffect: 'diagnostic',
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

describe('Diagnostic holds are inert (#2628 review)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let ledger: ReservationLedger;
  let shortfalls: IReservationShortfallService;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    ledger = harness.getApp().get<ReservationLedger>(RESERVATION_REPOSITORY_TOKEN);
    shortfalls = harness
      .getApp()
      .get<IReservationShortfallService>(RESERVATION_SHORTFALL_SERVICE_TOKEN);
  }, 120_000);

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  /**
   * The default topology, run forward: 12 orders, each holding the FULL stock
   * diagnostically, none of which anything ever closes. The counter ends at 120
   * against a stock of 10 — an install that has been up long enough for the
   * unbounded growth to matter.
   */
  async function accumulateDiagnosticHolds(
    inventoryItemId: string,
    orders: number
  ): Promise<void> {
    for (let i = 0; i < orders; i += 1) {
      await ledger.claimHeld([
        claim({ inventoryItemId, orderRecordId: `ol_order_diag_${i}`, quantity: STOCK }),
      ]);
    }
  }

  it('should keep admitting orders after diagnostic holds have accumulated far past the stock level', async () => {
    const position = await seedPosition(dataSource, STOCK);

    await accumulateDiagnosticHolds(position.inventoryItemId, 12);

    // The counter really did grow without bound — this is the premise, not an
    // incidental detail. If a future change makes it stop growing, this
    // assertion says so rather than letting the test quietly stop testing.
    expect(await readCounter(dataSource, position.inventoryItemId)).toBe(12 * STOCK);

    // The order that arrives next is perfectly ordinary and must be admitted.
    // Before the fix this raised `InsufficientAvailabilityError` — and the
    // caller swallows that, so the order simply vanished from the ledger.
    const [outcome] = await ledger.claimHeld([
      claim({
        inventoryItemId: position.inventoryItemId,
        orderRecordId: 'ol_order_diag_next',
        quantity: STOCK,
      }),
    ]);

    expect(outcome.deltaApplied).toBe(STOCK);
    // A diagnostic hold promises nothing, so the published ATP is untouched by
    // every one of the 13 holds now standing.
    expect(outcome.remainingAtp).toBe(STOCK);
  });

  it('should open no shortfall episode however many diagnostic holds stand against the position', async () => {
    const position = await seedPosition(dataSource, STOCK);

    await accumulateDiagnosticHolds(position.inventoryItemId, 12);

    const result = await shortfalls.detectShortfalls(RUN);

    expect(result.episodesOpened).toBe(0);
    // Not merely "no episode": nothing was even a candidate, so no unattributed
    // residue was logged either. A counter-blind predicate would have reported
    // 110 short units here.
    expect(result.unattributed).toBe(0);
    expect(await countEpisodes(dataSource, position.inventoryItemId)).toBe(0);
  });

  it('should still refuse an order that would oversell the PUBLISHED promise', async () => {
    // The other direction. Without this the two tests above would pass against a
    // guard that had simply stopped guarding.
    const position = await seedPosition(dataSource, STOCK);

    await ledger.claimHeld([
      claim({
        inventoryItemId: position.inventoryItemId,
        orderRecordId: 'ol_order_pub_1',
        atpEffect: 'published',
        quantity: STOCK,
      }),
    ]);

    await expect(
      ledger.claimHeld([
        claim({
          inventoryItemId: position.inventoryItemId,
          orderRecordId: 'ol_order_pub_2',
          atpEffect: 'published',
          quantity: 1,
        }),
      ])
    ).rejects.toBeInstanceOf(InsufficientAvailabilityError);
  });

  it('should still open a shortfall episode for a PUBLISHED hold the master dropped below', async () => {
    const position = await seedPosition(dataSource, STOCK);

    await ledger.claimHeld([
      claim({
        inventoryItemId: position.inventoryItemId,
        orderRecordId: 'ol_order_pub_short',
        atpEffect: 'published',
        quantity: STOCK,
      }),
    ]);
    // The master drops to 2 against a promise of 10.
    await dataSource.query(
      `UPDATE "inventory_items" SET "availableQuantity" = 2 WHERE "id" = $1`,
      [position.inventoryItemId]
    );

    const result = await shortfalls.detectShortfalls(RUN);

    expect(result.episodesOpened).toBe(1);
    expect(await countEpisodes(dataSource, position.inventoryItemId)).toBe(1);
  });

  it('should attribute a published shortfall to the published order, never to a diagnostic one alongside it', async () => {
    // The mixed position — the case that decides whether the attribution read is
    // scoped as well as the predicate. A diagnostic hold that absorbed a share
    // would both name an order that promised nothing and HIDE the published
    // order that did.
    const position = await seedPosition(dataSource, STOCK);

    await ledger.claimHeld([
      claim({
        inventoryItemId: position.inventoryItemId,
        orderRecordId: 'ol_order_mixed_published',
        atpEffect: 'published',
        quantity: 6,
      }),
    ]);
    // Younger than the published hold, so youngest-first attribution would reach
    // it FIRST if the read were unscoped — and sized 4, which is exactly the
    // shortfall below, so an unscoped read would absorb the WHOLE of it here and
    // leave the published order with no episode at all.
    //
    // 4 is also the largest a claim can be at this point, and deliberately so:
    // scoping narrowed the guard's SUBTRAHEND to published holds, it did not
    // exempt a diagnostic claim from needing headroom the size of the claim
    // (ADR-061 — a diagnostic hold does not PROMISE stock, which is not the same
    // as costing nothing to take). With 10 stock and 6 published, the headroom
    // is 4; asking for more is refused, correctly.
    await ledger.claimHeld([
      claim({
        inventoryItemId: position.inventoryItemId,
        orderRecordId: 'ol_order_mixed_diagnostic',
        atpEffect: 'diagnostic',
        quantity: 4,
      }),
    ]);
    await dataSource.query(
      `UPDATE "inventory_items" SET "availableQuantity" = 2 WHERE "id" = $1`,
      [position.inventoryItemId]
    );

    await shortfalls.detectShortfalls(RUN);

    const episodes = (await dataSource.query(
      `SELECT "orderRecordId", "shortQuantity", "positionShortfall"
         FROM "reservation_shortfall_episodes" WHERE "inventoryItemId" = $1`,
      [position.inventoryItemId]
    )) as { orderRecordId: string; shortQuantity: number; positionShortfall: number }[];

    expect(episodes).toHaveLength(1);
    expect(episodes[0].orderRecordId).toBe('ol_order_mixed_published');
    // 6 promised, 2 available — the diagnostic 10 contributes nothing to either
    // the shortfall or its attribution.
    expect(Number(episodes[0].positionShortfall)).toBe(4);
    expect(Number(episodes[0].shortQuantity)).toBe(4);
  });
});
