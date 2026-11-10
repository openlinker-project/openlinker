import { GiftReportService } from '../gift-report.service';

describe('GiftReportService, overlay gift cost (#3939)', () => {
  const record = (unitCostNet?: string) =>
    ({
      internalOrderId: 'o1',
      orderNumber: null,
      placedAt: new Date('2026-01-10T00:00:00Z'),
      sourceConnectionId: 'c1',
      customerId: null,
      currency: 'PLN',
      channelSnapshot: { items: [{ id: 'l1' }] },
      bundleLines: [],
      orderItems: [
        {
          id: 'ol-gift:r1:1',
          productId: 'p1',
          variantId: 'v1',
          quantity: 2,
          price: 0,
          gift: { source: 'ol-rule', ruleRef: 'r1' },
        },
      ],
      orderEdits:
        unitCostNet === undefined
          ? null
          : { addedLines: { 'ol-gift:r1:1': { unitCostNet, unitCostCurrency: 'PLN' } } },
    }) as never;

  const build = (rec: unknown, catalogueCost: string | null) => {
    const reader = { findForGiftReport: jest.fn().mockResolvedValueOnce([rec]).mockResolvedValue([]) };
    const lineItems = { findByOrderIds: jest.fn().mockResolvedValue(new Map()) };
    const products = {
      getVariantsByIds: jest.fn().mockResolvedValue([
        { id: 'v1', productId: 'p1', sku: 'S', netUnitCost: catalogueCost, costCurrency: 'PLN' },
      ]),
      getProductsByIds: jest.fn().mockResolvedValue([{ id: 'p1', name: 'Mug' }]),
    };
    return new GiftReportService(reader as never, lineItems as never, products as never);
  };
  const filters = { from: new Date('2026-01-01'), to: new Date('2026-02-01') };

  it('should prefer the cost frozen on the overlay entry over today\'s catalogue cost', async () => {
    const [entry] = await build(record('3.0000'), '9.0000').listEntries(filters);

    expect(entry).toMatchObject({ unitCostNet: 3, totalCostNet: 6, costBasis: 'snapshot' });
  });

  it('should fall back to the catalogue when the entry froze no cost', async () => {
    const [entry] = await build(record(), '9.0000').listEntries(filters);

    expect(entry).toMatchObject({ unitCostNet: 9, costBasis: 'catalogue' });
  });

  it('should report unknown, never 0, when neither has a cost', async () => {
    const [entry] = await build(record(), null).listEntries(filters);

    expect(entry).toMatchObject({ unitCostNet: null, totalCostNet: null, costBasis: 'unknown' });
  });
});

describe('GiftReportService, bundle components', () => {
  const record = {
    internalOrderId: 'o1',
    currency: 'PLN',
    taxTreatment: null,
    orderItems: [{ id: 'l1', sku: 'SET', name: 'Set', quantity: 2, price: 100, taxRate: null }],
    bundleLines: [
      {
        lineId: 'l1',
        bundleVariantId: 'b1',
        components: [
          { variantId: 'v1', productId: 'p1', quantity: 2, giftSlot: false },
          { variantId: 'v2', productId: 'p2', quantity: 2, giftSlot: true },
        ],
      },
    ],
  } as never;

  const build = (costs: Record<string, string | null>) => {
    const reader = { findForGiftReport: jest.fn().mockResolvedValueOnce([record]).mockResolvedValue([]) };
    const lineItems = { findByOrderIds: jest.fn(), getUnitsSoldByVariants: jest.fn().mockResolvedValue(new Map()) };
    const products = {
      getVariantsByIds: jest.fn().mockResolvedValue([
        { id: 'v1', productId: 'p1', sku: 'A', netUnitCost: costs.v1, costCurrency: 'PLN' },
        { id: 'v2', productId: 'p2', sku: 'B', netUnitCost: costs.v2, costCurrency: 'PLN' },
      ]),
      getProductsByIds: jest.fn().mockResolvedValue([
        { id: 'p1', name: 'Coffee' },
        { id: 'p2', name: 'Spoon' },
      ]),
    };
    return new GiftReportService(reader as never, lineItems as never, products as never);
  };
  const filters = { from: new Date('2026-01-01'), to: new Date('2026-02-01') };

  it('should list what each component drew and what the gift part costs', async () => {
    const { bundles } = await build({ v1: '10.0000', v2: '1.5000' }).getBundleReport(filters);

    expect(bundles[0]).toMatchObject({ unitsSold: 2, costNet: 23, giftCostNet: 3 });
    expect(bundles[0].components).toEqual([
      expect.objectContaining({ variantId: 'v1', units: 2, unitCostNet: 10, costNet: 20, giftSlot: false }),
      expect.objectContaining({ variantId: 'v2', units: 2, unitCostNet: 1.5, costNet: 3, giftSlot: true, name: 'Spoon' }),
    ]);
  });

  it('should leave a component cost unknown, never zero, and withhold the bundle cost', async () => {
    const { bundles } = await build({ v1: '10.0000', v2: null }).getBundleReport(filters);

    expect(bundles[0]).toMatchObject({ costNet: null, componentCostMissing: true, giftCostNet: 0 });
    expect(bundles[0].components[1]).toMatchObject({ unitCostNet: null, costNet: null });
  });
});
