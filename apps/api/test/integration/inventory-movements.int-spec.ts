/**
 * Inventory Movements Integration Test (#3565)
 *
 * Vertical slice for the stock movement ledger against real Postgres
 * (Testcontainers):
 *  - a master sync change (a `setInventory` with no attribution) writes ONE
 *    `master_sync` row carrying the delta and the before/after quantities, and an
 *    unchanged re-write writes none;
 *  - `GET /inventory/movements` returns ledger rows and reservations as
 *    "Promised" rows, newest first, and honours the kind / reason / attention /
 *    search / variant filters;
 *  - `?withTotal=false` omits the total entirely;
 *  - a viewer may read the history.
 *
 * @module apps/api/test/integration
 */
import {
  IInventoryService,
  InventoryItemEntity,
  INVENTORY_SERVICE_TOKEN,
} from '@openlinker/core/inventory';
import {
  InventoryItemOrmEntity,
  InventoryMovementOrmEntity,
  ReservationOrmEntity,
} from '@openlinker/core/inventory/orm-entities';
import {
  ProductOrmEntity,
  ProductVariantOrmEntity,
} from '@openlinker/core/products/orm-entities';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { loginAsViewer } from './helpers/test-auth.helper';

const BASE = '/v1/inventory/movements';

describe('Inventory movements (#3565)', () => {
  let harness: IntegrationTestHarness;
  let inventoryService: IInventoryService;

  beforeAll(async () => {
    harness = await getTestHarness();
    inventoryService = harness.getApp().get<IInventoryService>(INVENTORY_SERVICE_TOKEN);
  });
  afterEach(async () => {
    await resetTestHarness();
  });
  afterAll(async () => {
    await teardownTestHarness();
  });

  async function seedVariantPosition(
    quantity: number,
    sku = 'MOV-SKU-1'
  ): Promise<{ productId: string; variantId: string; inventoryId: string }> {
    const ds = harness.getDataSource();
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const productId = `ol_product_mov_${suffix}`;
    const variantId = `ol_variant_mov_${suffix}`;
    const inventoryId = `ol_inventory_mov_${suffix}`;
    const products = ds.getRepository(ProductOrmEntity);
    await products.save(
      products.create({ id: productId, name: 'Movement Widget', sku: null, price: null })
    );
    const variants = ds.getRepository(ProductVariantOrmEntity);
    await variants.save(
      variants.create({ id: variantId, productId, sku, attributes: null, ean: null, gtin: null })
    );
    const inventory = ds.getRepository(InventoryItemOrmEntity);
    await inventory.save(
      inventory.create({
        id: inventoryId,
        productId,
        productVariantId: variantId,
        availableQuantity: quantity,
        reservedQuantity: 0,
        locationId: null,
        sourceConnectionId: 'conn-master',
      })
    );
    return { productId, variantId, inventoryId };
  }

  const itemFor = (
    ids: { productId: string; variantId: string; inventoryId: string },
    available: number
  ): InventoryItemEntity =>
    new InventoryItemEntity(
      ids.inventoryId,
      ids.productId,
      ids.variantId,
      available,
      0,
      null,
      new Date(),
      false,
      'conn-master'
    );

  async function movements(): Promise<InventoryMovementOrmEntity[]> {
    return harness
      .getDataSource()
      .getRepository(InventoryMovementOrmEntity)
      .find({ order: { occurredAt: 'ASC' } });
  }

  describe('ledger write', () => {
    it('should record a master_sync row with the delta when the master changed the stock', async () => {
      const ids = await seedVariantPosition(10);

      await inventoryService.setInventory(itemFor(ids, 7), 'conn-master');

      const rows = await movements();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        productVariantId: ids.variantId,
        reason: 'master_sync',
        status: 'applied',
        sourceKind: 'master_sync',
        sourceConnectionId: 'conn-master',
        quantityBefore: 10,
        quantityAfter: 7,
        quantityDelta: -3,
      });
    });

    it('should write no row when a sync re-reports the same quantity', async () => {
      const ids = await seedVariantPosition(10);

      await inventoryService.setInventory(itemFor(ids, 10), 'conn-master');

      expect(await movements()).toHaveLength(0);
    });

    it('should carry a caller attribution onto the row', async () => {
      const ids = await seedVariantPosition(10);

      await inventoryService.setInventory(itemFor(ids, 9), 'conn-master', {
        reason: 'sale',
        sourceKind: 'order',
        sourceRef: 'ol_order_1',
      });

      const [row] = await movements();
      expect(row).toMatchObject({ reason: 'sale', sourceKind: 'order', sourceRef: 'ol_order_1' });
    });
  });

  describe('GET /inventory/movements', () => {
    async function seedHistory(): Promise<{
      variantId: string;
      productId: string;
      token: string;
    }> {
      const ds = harness.getDataSource();
      const ids = await seedVariantPosition(10);
      await inventoryService.setInventory(itemFor(ids, 7), 'conn-master'); // master_sync -3
      await inventoryService.setInventory(itemFor(ids, 6), 'conn-master', {
        reason: 'sale',
        sourceKind: 'order',
        sourceRef: 'ol_order_1',
      }); // sale -1

      const ledger = ds.getRepository(InventoryMovementOrmEntity);
      await ledger.save(
        ledger.create({
          productId: ids.productId,
          productVariantId: ids.variantId,
          locationId: null,
          sourceConnectionId: 'conn-master',
          reason: 'manual_correction',
          status: 'refused',
          quantityDelta: 5,
          quantityBefore: null,
          quantityAfter: null,
          sourceKind: 'operator',
          sourceRef: null,
          actorUserId: 'user-1',
          operatorReason: 'found',
          note: null,
          idempotencyKey: 'idem-refused-1',
          refusalReason: 'master-refused',
          refusalDetail: 'multi-shop install with no shop id',
          occurredAt: new Date(),
        })
      );

      const reservations = ds.getRepository(ReservationOrmEntity);
      await reservations.save(
        reservations.create({
          orderRecordId: 'ol_order_2',
          orderLineId: 'line-1',
          inventoryItemId: ids.inventoryId,
          quantity: 2,
          status: 'held',
          expiresAt: new Date(Date.now() + 86_400_000),
          atpEffect: 'published',
        })
      );

      const token = await loginAsViewer(harness.getHttp(), ds);
      return { ...ids, token };
    }

    const get = async (
      token: string,
      query: Record<string, string>
    ): Promise<{ items: Array<Record<string, unknown>>; total?: number }> => {
      const res = await harness
        .getHttp()
        .get(BASE)
        .query(query)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      return res.body as { items: Array<Record<string, unknown>>; total?: number };
    };

    it('should return ledger rows and the reservation as a Promised row, with a total', async () => {
      const { token, variantId } = await seedHistory();

      const body = await get(token, { productVariantId: variantId });

      expect(body.total).toBe(4);
      const kinds = body.items.map((item) => item.kind);
      expect(kinds.filter((kind) => kind === 'movement')).toHaveLength(3);
      const promised = body.items.find((item) => item.kind === 'reservation');
      expect(promised).toMatchObject({
        reason: null,
        status: 'held',
        quantityDelta: 2,
        sourceRef: 'ol_order_2',
        sku: 'MOV-SKU-1',
      });
    });

    it('should filter to promised rows only', async () => {
      const { token } = await seedHistory();

      const body = await get(token, { kind: 'promised' });

      expect(body.items).toHaveLength(1);
      expect(body.items[0].kind).toBe('reservation');
    });

    it('should filter by reason, leaving promised rows out', async () => {
      const { token } = await seedHistory();

      const body = await get(token, { reasons: 'sale' });

      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({ reason: 'sale', quantityDelta: -1 });
    });

    it('should return only refused and in-doubt rows for needsAttention', async () => {
      const { token } = await seedHistory();

      const body = await get(token, { needsAttention: 'true' });

      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        status: 'refused',
        refusalReason: 'master-refused',
        refusalDetail: 'multi-shop install with no shop id',
        quantityAfter: null,
      });
    });

    it('should find a variant by SKU search and nothing for a non-matching one', async () => {
      const { token } = await seedHistory();

      expect((await get(token, { search: 'mov-sku' })).items.length).toBeGreaterThan(0);
      expect((await get(token, { search: 'no-such-sku' })).items).toHaveLength(0);
    });

    it('should omit the total entirely when withTotal=false', async () => {
      const { token } = await seedHistory();

      const body = await get(token, { withTotal: 'false', limit: '2' });

      expect(body.items).toHaveLength(2);
      expect(body).not.toHaveProperty('total');
    });
  });
});
