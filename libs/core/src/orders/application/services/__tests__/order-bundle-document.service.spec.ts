import type { IProductsService } from '@openlinker/core/products';
import type { OrderRecord } from '../../../domain/entities/order-record.entity';
import { OrderBundleDocumentService } from '../order-bundle-document.service';

const record = {
  internalOrderId: 'o1',
  currency: 'PLN',
  bundleLines: [
    {
      lineId: 'L1',
      bundleVariantId: 'vs',
      version: 1,
      components: [
        { lineId: 'L1~c:a', variantId: 'a', productId: 'pa', quantity: 2, perUnit: 1 },
        { lineId: 'L1~c:g', variantId: 'g', productId: 'pg', quantity: 2, perUnit: 1, giftSlot: true },
      ],
    },
  ],
} as unknown as OrderRecord;

function build() {
  const products = {
    getVariantsByIds: jest.fn().mockResolvedValue([
      { id: 'a', productId: 'pa', sku: 'A-1', price: 80, taxRate: '23', netUnitCost: '30.0000', costCurrency: 'PLN' },
      { id: 'g', productId: 'pg', sku: 'G-1', price: 20, netUnitCost: '4.5000', costCurrency: 'PLN' },
    ]),
    getProductsByIds: jest.fn().mockResolvedValue([
      { id: 'pa', name: 'Soap' },
      { id: 'pg', name: 'Candle', taxRate: '8' },
    ]),
  } as unknown as IProductsService;
  return { service: new OrderBundleDocumentService(products), products };
}

describe('OrderBundleDocumentService', () => {
  it('should resolve nothing and read no products when the order has no bundle', async () => {
    const { service, products } = build();
    await expect(
      service.resolveForDocuments({ ...record, bundleLines: [] } as unknown as OrderRecord, 'c1'),
    ).resolves.toBeUndefined();
    expect(products.getVariantsByIds).not.toHaveBeenCalled();
  });

  it('should resolve components with names, prices, catalogue rates and the gift slot', async () => {
    const { service } = build();
    const result = await service.resolveForDocuments(record, 'c1');
    expect(result?.byLineId.L1).toEqual([
      expect.objectContaining({ name: 'Soap', unitPriceGross: 80, unitCostNet: 30, taxRate: '23' }),
      expect.objectContaining({
        name: 'Candle',
        giftSlot: true,
        unitPriceGross: 20,
        unitCostNet: 4.5,
        taxRate: '8',
      }),
    ]);
  });

  it('should propagate a failed read rather than change the shape of the document', async () => {
    const { service, products } = build();
    (products.getVariantsByIds as jest.Mock).mockRejectedValue(new Error('db'));
    await expect(service.resolveForDocuments(record, 'c1')).rejects.toThrow('db');
  });

  it('should report the cost of each gift slot for the analytics read', async () => {
    const { service } = build();
    await expect(service.getGiftSlotCosts(record)).resolves.toEqual([
      {
        lineId: 'L1',
        componentLineId: 'L1~c:g',
        variantId: 'g',
        quantity: 2,
        unitCostNet: '4.5000',
        costCurrency: 'PLN',
        totalCostNet: 9,
      },
    ]);
  });

  it('should report an unknown cost as null, never as zero', async () => {
    const { service, products } = build();
    (products.getVariantsByIds as jest.Mock).mockResolvedValue([
      { id: 'g', productId: 'pg', sku: 'G-1', netUnitCost: null, costCurrency: null },
    ]);
    const [line] = await service.getGiftSlotCosts(record);
    expect(line.totalCostNet).toBeNull();
  });
});
