/**
 * Reservation shortfall episodes against real Postgres (#2349, story I6)
 *
 * The unit specs prove the reconciler's decisions against a fake repository.
 * They cannot prove the thing the whole episode model rests on — the **partial
 * unique index**. "Re-detecting an open episode writes nothing" and "a
 * recurrence mints a NEW occurrence id" are claims about `ON CONFLICT ... WHERE
 * "closedAt" IS NULL`, and only a real database can settle them.
 *
 * Four claims, in the order the issue states them:
 *
 * - lowering a master's quantity below the reserved total produces a fact
 *   naming an ORDER and a SKU;
 * - three runs over one standing shortfall leave ONE episode and ONE row;
 * - recovery closes by an explicit `closedAt` write and the row stays readable;
 * - a recurrence after a close is a NEW episode with a NEW id.
 *
 * Plus the two this slice adds: cancellation is an independent close trigger
 * (`released` became reachable in #2348), and NOTHING is clamped.
 *
 * The harness builds its schema by `synchronize`, matching every #2314 / #2343
 * / #2345 sibling.
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
  RESERVATION_SHORTFALL_SERVICE_TOKEN,
  type IReservationShortfallService,
} from '@openlinker/core/inventory';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

const EXPIRES_AT = new Date('2027-01-01T00:00:00.000Z');
const RUN = { detectLimit: 100, closeLimit: 100, detectOffset: 0, closeOffset: 0 };

const ORDER_A = 'ol_order_shortfall_a';
const ORDER_B = 'ol_order_shortfall_b';

interface SeededPosition {
  inventoryItemId: string;
  productId: string;
  variantId: string;
  sku: string;
}

async function seedPosition(
  dataSource: DataSource,
  availableQuantity: number
): Promise<SeededPosition> {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const productId = `ol_product_sf_${suffix}`;
  const variantId = `ol_variant_sf_${suffix}`;
  const inventoryItemId = `ol_inventoryitem_sf_${suffix}`;
  const sku = `SKU-SF-${suffix}`;

  const productRepo = dataSource.getRepository(ProductOrmEntity);
  await productRepo.save(
    productRepo.create({ id: productId, name: `Shortfall ${suffix}`, sku: null, price: null })
  );

  const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
  await variantRepo.save(
    variantRepo.create({
      id: variantId,
      productId,
      sku,
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
      sourceConnectionId: 'conn-shortfall-test',
      isStale: false,
    })
  );

  return { inventoryItemId, productId, variantId, sku };
}

/**
 * Insert a ledger row directly.
 *
 * Deliberately NOT through `claimHeld`, which guards availability and would
 * refuse the very shape this spec exists to exercise: a hold larger than the
 * stock behind it. #2343's own int-spec owns the write path.
 */
async function insertHold(
  dataSource: DataSource,
  input: {
    orderRecordId: string;
    inventoryItemId: string;
    quantity: number;
    orderLineId?: string;
    createdAt?: Date;
  }
): Promise<void> {
  await dataSource.query(
    `INSERT INTO "reservations"
       ("orderRecordId", "orderLineId", "inventoryItemId", "quantity", "status",
        "expiresAt", "atpEffect", "closedAt", "createdAt")
     VALUES ($1, $2, $3, $4, 'held', $5, 'published', NULL, $6)`,
    [
      input.orderRecordId,
      input.orderLineId ?? `line-${Math.floor(Math.random() * 1_000_000)}`,
      input.inventoryItemId,
      input.quantity,
      EXPIRES_AT,
      input.createdAt ?? new Date(),
    ]
  );
}

/** Drop the master's quantity — the event story I6 is about. */
async function setAvailable(
  dataSource: DataSource,
  inventoryItemId: string,
  availableQuantity: number
): Promise<void> {
  await dataSource.query(`UPDATE "inventory_items" SET "availableQuantity" = $2 WHERE "id" = $1`, [
    inventoryItemId,
    availableQuantity,
  ]);
}

/** The counter is denormalised over the ledger; the ledger is authoritative. */
async function setOlReserved(
  dataSource: DataSource,
  inventoryItemId: string,
  olReservedQuantity: number
): Promise<void> {
  await dataSource.query(
    `UPDATE "inventory_items" SET "olReservedQuantity" = $2 WHERE "id" = $1`,
    [inventoryItemId, olReservedQuantity]
  );
}

interface EpisodeRow {
  id: string;
  orderRecordId: string;
  sku: string | null;
  shortQuantity: number;
  positionShortfall: number;
  closedAt: Date | null;
  closeReason: string | null;
}

async function readEpisodes(
  dataSource: DataSource,
  inventoryItemId: string
): Promise<EpisodeRow[]> {
  return (await dataSource.query(
    `SELECT "id", "orderRecordId", "sku", "shortQuantity", "positionShortfall",
            "closedAt", "closeReason"
       FROM "reservation_shortfall_episodes"
      WHERE "inventoryItemId" = $1
      ORDER BY "openedAt" ASC, "id" ASC`,
    [inventoryItemId]
  )) as EpisodeRow[];
}

describe('Reservation shortfall episodes (#2349)', () => {
  let harness: IntegrationTestHarness;
  let dataSource: DataSource;
  let shortfalls: IReservationShortfallService;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
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

  it('should produce a shortfall fact naming an order and a sku when the master drops below the reserved total', async () => {
    const position = await seedPosition(dataSource, 10);
    await insertHold(dataSource, {
      orderRecordId: ORDER_A,
      inventoryItemId: position.inventoryItemId,
      quantity: 4,
    });
    await setOlReserved(dataSource, position.inventoryItemId, 4);
    // The master drops: 4 promised, only 1 left.
    await setAvailable(dataSource, position.inventoryItemId, 1);

    const result = await shortfalls.detectShortfalls(RUN);

    expect(result.episodesOpened).toBe(1);
    const episodes = await readEpisodes(dataSource, position.inventoryItemId);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].orderRecordId).toBe(ORDER_A);
    expect(episodes[0].sku).toBe(position.sku);
    expect(Number(episodes[0].shortQuantity)).toBe(3);
    expect(Number(episodes[0].positionShortfall)).toBe(3);
    expect(episodes[0].closedAt).toBeNull();
  });

  it('should clamp no number as a side effect', async () => {
    const position = await seedPosition(dataSource, 1);
    await insertHold(dataSource, {
      orderRecordId: ORDER_A,
      inventoryItemId: position.inventoryItemId,
      quantity: 4,
    });
    await setOlReserved(dataSource, position.inventoryItemId, 4);

    await shortfalls.detectShortfalls(RUN);

    // The whole point of design § 4.2 declining the CHECK: the impossible
    // state PERSISTS, visibly, instead of being quietly made consistent.
    const [item] = (await dataSource.query(
      `SELECT "availableQuantity", "olReservedQuantity" FROM "inventory_items" WHERE "id" = $1`,
      [position.inventoryItemId]
    )) as Array<{ availableQuantity: number; olReservedQuantity: number }>;
    expect(Number(item.availableQuantity)).toBe(1);
    expect(Number(item.olReservedQuantity)).toBe(4);

    const [hold] = (await dataSource.query(
      `SELECT "quantity", "status" FROM "reservations" WHERE "inventoryItemId" = $1`,
      [position.inventoryItemId]
    )) as Array<{ quantity: number; status: string }>;
    expect(Number(hold.quantity)).toBe(4);
    expect(hold.status).toBe('held');
  });

  it('should write nothing on re-detection: three runs over one standing shortfall leave one episode', async () => {
    const position = await seedPosition(dataSource, 1);
    await insertHold(dataSource, {
      orderRecordId: ORDER_A,
      inventoryItemId: position.inventoryItemId,
      quantity: 4,
    });
    await setOlReserved(dataSource, position.inventoryItemId, 4);

    const first = await shortfalls.detectShortfalls(RUN);
    const second = await shortfalls.detectShortfalls(RUN);
    const third = await shortfalls.detectShortfalls(RUN);

    expect(first.episodesOpened).toBe(1);
    expect(second.episodesOpened).toBe(0);
    expect(third.episodesOpened).toBe(0);
    expect(second.episodesStillOpen).toBe(1);
    expect(third.episodesStillOpen).toBe(1);

    const episodes = await readEpisodes(dataSource, position.inventoryItemId);
    expect(episodes).toHaveLength(1);
  });

  it('should refresh the quantities on re-detection while keeping the episode id (#2628 review)', async () => {
    // UNVERIFIED at the time of writing — the Docker daemon is wedged host-side,
    // so this case has never executed. It is committed rather than omitted so
    // the claim is testable the moment the daemon is healthy.
    const position = await seedPosition(dataSource, 1);
    await insertHold(dataSource, {
      orderRecordId: ORDER_A,
      inventoryItemId: position.inventoryItemId,
      quantity: 5,
    });
    await setOlReserved(dataSource, position.inventoryItemId, 5);
    await shortfalls.detectShortfalls(RUN);

    const [opened] = await readEpisodes(dataSource, position.inventoryItemId);
    expect(Number(opened.shortQuantity)).toBe(4);

    // The master partially recovers: the shortfall shrinks but does not clear.
    await setAvailable(dataSource, position.inventoryItemId, 3);
    await shortfalls.detectShortfalls(RUN);

    const episodes = await readEpisodes(dataSource, position.inventoryItemId);
    expect(episodes).toHaveLength(1);
    // The ID is what an edge-triggered automation keys on, so it must NOT move
    // just because the numbers did.
    expect(episodes[0].id).toBe(opened.id);
    // ...and the numbers MUST move, or the row asserts a figure nothing
    // recomputes.
    expect(Number(episodes[0].shortQuantity)).toBe(2);
    expect(Number(episodes[0].positionShortfall)).toBe(2);
    expect(episodes[0].closedAt).toBeNull();
  });

  it('should close the episode by an explicit write when the master recovers, and keep it readable', async () => {
    const position = await seedPosition(dataSource, 1);
    await insertHold(dataSource, {
      orderRecordId: ORDER_A,
      inventoryItemId: position.inventoryItemId,
      quantity: 4,
    });
    await setOlReserved(dataSource, position.inventoryItemId, 4);
    await shortfalls.detectShortfalls(RUN);

    // The master restocks.
    await setAvailable(dataSource, position.inventoryItemId, 10);
    const result = await shortfalls.detectShortfalls(RUN);

    expect(result.episodesClosed).toBe(1);
    const episodes = await readEpisodes(dataSource, position.inventoryItemId);
    expect(episodes).toHaveLength(1);
    // Still readable — closed by a `closedAt` write, not by ceasing to match a
    // predicate.
    expect(episodes[0].closedAt).not.toBeNull();
    expect(episodes[0].closeReason).toBe('recovered');
  });

  it('should close the episode when the order is cancelled, even while the position stays short', async () => {
    const position = await seedPosition(dataSource, 1);
    await insertHold(dataSource, {
      orderRecordId: ORDER_A,
      inventoryItemId: position.inventoryItemId,
      quantity: 3,
      orderLineId: 'line-a',
    });
    await insertHold(dataSource, {
      orderRecordId: ORDER_B,
      inventoryItemId: position.inventoryItemId,
      quantity: 3,
      orderLineId: 'line-b',
    });
    await setOlReserved(dataSource, position.inventoryItemId, 6);
    await shortfalls.detectShortfalls(RUN);

    const openBefore = (await readEpisodes(dataSource, position.inventoryItemId)).filter(
      (row) => row.closedAt === null
    );
    expect(openBefore.length).toBeGreaterThan(0);

    // Order A is cancelled: #2348 made `released` a reachable terminal status,
    // so its hold leaves the `held` set immediately — while the position is
    // still short for order B.
    await dataSource.query(
      `UPDATE "reservations" SET "status" = 'released', "closedAt" = now()
        WHERE "orderRecordId" = $1 AND "inventoryItemId" = $2`,
      [ORDER_A, position.inventoryItemId]
    );

    await shortfalls.detectShortfalls(RUN);

    const episodes = await readEpisodes(dataSource, position.inventoryItemId);
    const forA = episodes.filter((row) => row.orderRecordId === ORDER_A);
    expect(forA).toHaveLength(1);
    expect(forA[0].closedAt).not.toBeNull();
    expect(forA[0].closeReason).toBe('reservation-closed');
  });

  it('should open a NEW episode with a NEW occurrence id when the shortfall recurs after a close', async () => {
    const position = await seedPosition(dataSource, 1);
    await insertHold(dataSource, {
      orderRecordId: ORDER_A,
      inventoryItemId: position.inventoryItemId,
      quantity: 4,
    });
    await setOlReserved(dataSource, position.inventoryItemId, 4);

    await shortfalls.detectShortfalls(RUN);
    const [firstEpisode] = await readEpisodes(dataSource, position.inventoryItemId);

    // Recover, so the episode closes.
    await setAvailable(dataSource, position.inventoryItemId, 10);
    await shortfalls.detectShortfalls(RUN);

    // ... and drop again.
    await setAvailable(dataSource, position.inventoryItemId, 1);
    const recurrence = await shortfalls.detectShortfalls(RUN);

    expect(recurrence.episodesOpened).toBe(1);
    const episodes = await readEpisodes(dataSource, position.inventoryItemId);
    expect(episodes).toHaveLength(2);
    expect(episodes[0].id).toBe(firstEpisode.id);
    expect(episodes[0].closedAt).not.toBeNull();
    // A NEW occurrence id — which is what makes T8's "re-fires only if it
    // cleared and recurred" implementable.
    expect(episodes[1].id).not.toBe(firstEpisode.id);
    expect(episodes[1].closedAt).toBeNull();
  });

  it('should expose still-open episodes for one order through the order-detail read', async () => {
    const position = await seedPosition(dataSource, 1);
    await insertHold(dataSource, {
      orderRecordId: ORDER_A,
      inventoryItemId: position.inventoryItemId,
      quantity: 4,
    });
    await setOlReserved(dataSource, position.inventoryItemId, 4);
    await shortfalls.detectShortfalls(RUN);

    const open = await shortfalls.listOpenForOrder(ORDER_A);

    expect(open).toHaveLength(1);
    expect(open[0].sku).toBe(position.sku);
    expect(open[0].isOpen()).toBe(true);
  });
});
