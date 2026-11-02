/**
 * Order Line Costs Integration Test (#3588, D27)
 *
 * One EUR gross-priced order (23% VAT) with four lines: covered (cost 60 on a
 * 100 net line), no-cost, cost-entered-after-sale and no-variant. Asserts the
 * response and that an unknown order is a 404 (null from the service).
 *
 * @module apps/api/test/integration
 */
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { ORDER_LINE_COST_SERVICE_TOKEN, type IOrderLineCostService } from '@openlinker/core/orders';
import { OrderLineItemOrmEntity, OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';

const CONNECTION = '11111111-1111-4111-8111-111111111111';

describe('Order line costs (integration, #3588)', () => {
  let harness: IntegrationTestHarness;
  let service: IOrderLineCostService;

  beforeAll(async () => {
    harness = await getTestHarness();
    service = harness.getApp().get<IOrderLineCostService>(ORDER_LINE_COST_SERVICE_TOKEN);
  });
  afterEach(async () => {
    await resetTestHarness();
  });
  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should classify every line of an order and leave an unknown order null', async () => {
    const ds = harness.getDataSource();
    const productRepo = ds.getRepository(ProductOrmEntity);
    await productRepo.save(
      productRepo.create({ id: 'ol_product_lc', name: 'P', sku: null, price: null })
    );
    const variantRepo = ds.getRepository(ProductVariantOrmEntity);
    for (const [id, cost] of [
      ['ol_variant_lc1', '60'],
      ['ol_variant_lc2', null],
      ['ol_variant_lc3', '10'],
    ] as const) {
      await variantRepo.save(
        variantRepo.create({
          id,
          productId: 'ol_product_lc',
          sku: null,
          attributes: null,
          ean: null,
          gtin: null,
          netUnitCost: cost,
          costCurrency: cost ? 'EUR' : null,
          costUpdatedAt: cost ? new Date('2026-10-01T00:00:00.000Z') : null,
        })
      );
    }
    const orderRepo = ds.getRepository(OrderRecordOrmEntity);
    await orderRepo.save(
      orderRepo.create({
        internalOrderId: 'ol_order_lc',
        customerId: null,
        sourceConnectionId: CONNECTION,
        sourceEventId: null,
        orderSnapshot: { items: [] },
        syncStatus: [],
        recordStatus: 'ready',
        cancelledAt: null,
        currency: 'EUR',
        taxTreatment: 'inclusive',
        placedAt: new Date('2026-09-02T10:00:00.000Z'),
        totalAmount: 492,
      })
    );
    const lineRepo = ds.getRepository(OrderLineItemOrmEntity);
    const base = {
      orderRecordId: 'ol_order_lc',
      productId: 'ol_product_lc',
      quantity: 1,
      unitPrice: 123,
      taxRate: '23',
      sourceConnectionId: CONNECTION,
      placedAt: new Date('2026-09-02T10:00:00.000Z'),
    };
    await lineRepo.save([
      lineRepo.create({
        ...base,
        lineNumber: 0,
        variantId: 'ol_variant_lc1',
        costState: 'recorded',
        unitCostNet: '60.0000',
        unitCostCurrency: 'EUR',
      } as OrderLineItemOrmEntity),
      lineRepo.create({
        ...base,
        lineNumber: 1,
        variantId: 'ol_variant_lc2',
        costState: 'not-recorded',
      } as OrderLineItemOrmEntity),
      lineRepo.create({
        ...base,
        lineNumber: 2,
        variantId: 'ol_variant_lc3',
        costState: 'not-recorded',
      } as OrderLineItemOrmEntity),
      lineRepo.create({
        ...base,
        lineNumber: 3,
        variantId: null,
        costState: 'not-recorded',
      } as OrderLineItemOrmEntity),
    ]);

    const result = await service.getLineCosts('ol_order_lc');
    expect(result?.currency).toBe('EUR');
    expect(result?.lines.map((l) => [l.lineNumber, l.gapReason, l.margin])).toEqual([
      [0, null, 40],
      [1, 'no-cost', null],
      [2, 'cost-entered-after-sale', null],
      [3, 'no-variant', null],
    ]);
    expect(await service.getLineCosts('ol_order_missing')).toBeNull();
  });
});
