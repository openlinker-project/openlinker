/**
 * Order Line Cost Service Unit Tests (#3588)
 */
import type { IProductsService, ProductVariant } from '@openlinker/core/products';
import { OrderLineItem } from '../../domain/entities/order-line-item.entity';
import type { OrderRecord } from '../../domain/entities/order-record.entity';
import type { OrderLineItemRepositoryPort } from '../../domain/ports/order-line-item-repository.port';
import type { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { OrderLineCostService } from './order-line-cost.service';

const line = (
  lineNumber: number,
  variantId: string | null,
  cost: { net: string; currency: string } | null,
  quantity = 2
): OrderLineItem =>
  new OrderLineItem(
    `li-${lineNumber}`,
    'ord-1',
    lineNumber,
    `p-${lineNumber}`,
    variantId,
    quantity,
    123,
    'conn-1',
    new Date('2026-09-27T18:41:00Z'),
    new Date('2026-09-27T18:41:00Z'),
    '23',
    null,
    null,
    cost ? cost.net : null,
    cost ? cost.currency : null,
    cost ? 'recorded' : 'not-recorded'
  );

function build(
  lines: OrderLineItem[],
  variantsWithCost: string[] = [],
  era: 'pre-rollout' | null = null
): OrderLineCostService {
  const record = {
    currency: 'PLN',
    taxTreatment: 'inclusive',
    taxRateEra: era,
    orderItems: [{ id: 'x', productId: 'p-1', sku: 'KUB-1', quantity: 2, price: 123 }],
  } as unknown as OrderRecord;
  const orders = {
    findById: jest.fn().mockImplementation(async (id: string) => (id === 'ord-1' ? record : null)),
  } as unknown as OrderRecordRepositoryPort;
  const items = {
    findByOrderId: jest.fn().mockResolvedValue(lines),
  } as unknown as OrderLineItemRepositoryPort;
  const products = {
    getVariantsByIds: jest
      .fn()
      .mockResolvedValue(
        variantsWithCost.map((id) => ({ id, netUnitCost: '5.0000' }) as unknown as ProductVariant)
      ),
  } as unknown as IProductsService;
  return new OrderLineCostService(orders, items, products);
}

describe('OrderLineCostService', () => {
  it('should return null when the order does not exist', async () => {
    expect(await build([]).getLineCosts('nope')).toBeNull();
  });

  it('should return no lines when the order has no line rows', async () => {
    expect(await build([]).getLineCosts('ord-1')).toEqual({ currency: 'PLN', lines: [] });
  });

  it('should compute cost of goods and margin from the net amount when recorded in the order currency', async () => {
    const result = await build([line(1, 'v-1', { net: '45.6000', currency: 'PLN' })]).getLineCosts(
      'ord-1'
    );
    const l = result!.lines[0];
    expect(l.netAmount).toBe(200); // 123*2/1.23
    expect(l.costOfGoods).toBe(91.2);
    expect(l.margin).toBe(108.8);
    expect(l.gapReason).toBeNull();
    expect(l.sku).toBe('KUB-1');
  });

  it('should count a 0.00 cost as covered', async () => {
    const result = await build([line(1, 'v-1', { net: '0.0000', currency: 'PLN' })]).getLineCosts(
      'ord-1'
    );
    expect(result!.lines[0].costOfGoods).toBe(0);
    expect(result!.lines[0].margin).toBe(200);
  });

  it('should report no-cost when not recorded and the variant has none now', async () => {
    const result = await build([line(1, 'v-1', null)]).getLineCosts('ord-1');
    expect(result!.lines[0]).toMatchObject({ gapReason: 'no-cost', margin: null, costOfGoods: null });
  });

  it('should report cost-entered-after-sale when not recorded but the variant has a cost now', async () => {
    const result = await build([line(1, 'v-1', null)], ['v-1']).getLineCosts('ord-1');
    expect(result!.lines[0].gapReason).toBe('cost-entered-after-sale');
  });

  it('should report no-variant when the line has no variant', async () => {
    const result = await build([line(1, null, null)]).getLineCosts('ord-1');
    expect(result!.lines[0].gapReason).toBe('no-variant');
  });

  it('should report currency-mismatch and no margin when the cost currency differs', async () => {
    const result = await build([line(1, 'v-1', { net: '10.0000', currency: 'EUR' })]).getLineCosts(
      'ord-1'
    );
    expect(result!.lines[0]).toMatchObject({ gapReason: 'currency-mismatch', margin: null });
  });

  it('should keep a pre-rollout order out of margin unless the setting admits it', async () => {
    const lines = [line(1, 'v-1', { net: '10.0000', currency: 'PLN' })];
    const off = await build(lines, [], 'pre-rollout').getLineCosts('ord-1', false);
    expect(off!.lines[0]).toMatchObject({ netEligible: false, margin: null });
    const on = await build(lines, [], 'pre-rollout').getLineCosts('ord-1', true);
    expect(on!.lines[0].netEligible).toBe(true);
  });
});
