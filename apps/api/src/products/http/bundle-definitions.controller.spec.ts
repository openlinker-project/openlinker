import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BundleDefinitionInvalidError, BundleNestingError } from '@openlinker/core/products';
import { BundleDefinitionsController } from './bundle-definitions.controller';

describe('BundleDefinitionsController (#3607)', () => {
  const bundles = {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    get: jest.fn(),
    list: jest.fn(),
    findCurrentByVariantIds: jest.fn(),
    history: jest.fn(),
    findCurrentContainingComponents: jest.fn(),
    confirmMultipack: jest.fn(),
  };
  const products = {
    getVariantsByIds: jest.fn(),
    getProductsByIds: jest.fn(),
  };
  const orderRecords = { countOpenOrdersByBundleVersion: jest.fn() };
  const provisioningResume = { resumeMultipackHeldOrders: jest.fn() };
  const inventoryQuery = { getAvailabilityByVariantIds: jest.fn() };
  const availability = { getPromisableQuantities: jest.fn() };
  const masterSync = { findBundleReadingMaster: jest.fn() };
  const controller = new BundleDefinitionsController(
    bundles as never,
    inventoryQuery as never,
    availability as never,
    products as never,
    orderRecords as never,
    provisioningResume as never,
    masterSync as never
  );

  beforeEach(() => {
    jest.resetAllMocks();
    masterSync.findBundleReadingMaster.mockResolvedValue(null);
    products.getVariantsByIds.mockResolvedValue([]);
    products.getProductsByIds.mockResolvedValue([]);
    orderRecords.countOpenOrdersByBundleVersion.mockResolvedValue([]);
    provisioningResume.resumeMultipackHeldOrders.mockResolvedValue({
      held: 0,
      enqueued: 0,
      notResumed: 0,
    });
  });

  it('should answer nesting as 409 with a machine-readable code', async () => {
    bundles.create.mockRejectedValue(new BundleNestingError('component-is-bundle', 'v1', 'v2'));
    await expect(
      controller.create({ variantId: 'v1', components: [{ variantId: 'v2', quantity: 1 }] })
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      controller.create({ variantId: 'v1', components: [{ variantId: 'v2', quantity: 1 }] })
    ).rejects.toMatchObject({ response: { code: 'BUNDLE_NESTING_REFUSED' } });
  });

  it('should answer an empty list, not a 404, when none of the asked variants is a bundle', async () => {
    bundles.findCurrentByVariantIds.mockResolvedValue([]);

    await expect(controller.list('v-plain')).resolves.toEqual([]);
    expect(bundles.findCurrentByVariantIds).toHaveBeenCalledWith(['v-plain']);
    expect(bundles.list).not.toHaveBeenCalled();
  });

  it('should 404 an unknown bundle', async () => {
    bundles.get.mockResolvedValue(null);
    await expect(controller.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should report per-component availability and the fewest bundles supported', async () => {
    bundles.get.mockResolvedValue({
      variantId: 'v-set',
      version: 2,
      components: [
        { variantId: 'v-a', productId: 'p-a', quantity: 3 },
        { variantId: 'v-b', productId: 'p-b', quantity: 1 },
      ],
    });
    inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([
      { productVariantId: 'v-a', availableToPromise: 10 },
      { productVariantId: 'v-b', availableToPromise: 2 },
    ]);
    availability.getPromisableQuantities.mockResolvedValue([
      { productVariantId: 'v-set', quantity: 2, provenance: 'computed' },
    ]);
    const result = await controller.get('v-set');
    expect(result.componentAvailability.map((c) => c.bundlesSupported)).toEqual([3, 2]);
    expect(result.bundlesAvailable).toBe(2);
  });

  it('should read an unknown component as null, never zero', async () => {
    bundles.get.mockResolvedValue({
      variantId: 'v-set',
      version: 1,
      components: [{ variantId: 'v-a', productId: 'p-a', quantity: 1 }],
    });
    inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([
      { productVariantId: 'v-a', availableToPromise: null },
    ]);
    availability.getPromisableQuantities.mockResolvedValue([
      { productVariantId: 'v-set', quantity: null, provenance: 'unknown' },
    ]);
    const result = await controller.get('v-set');
    expect(result.bundlesAvailable).toBeNull();
  });

  it('should send held multipack orders through ingestion again after a create', async () => {
    bundles.create.mockResolvedValue({
      variantId: 'v-set',
      version: 1,
      components: [{ variantId: 'v-a', productId: 'p-a', quantity: 3 }],
    });
    provisioningResume.resumeMultipackHeldOrders.mockResolvedValue({
      held: 2,
      enqueued: 2,
      notResumed: 0,
    });
    const result = await controller.create({
      variantId: 'v-set',
      components: [{ variantId: 'v-a', quantity: 3 }],
    });
    expect(result.releasedOrders).toBe(2);
  });

  it('should not release orders when the create is refused', async () => {
    bundles.create.mockRejectedValue(new BundleNestingError('component-is-self', 'v1', 'v1'));
    await expect(
      controller.create({ variantId: 'v1', components: [{ variantId: 'v1', quantity: 1 }] })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(provisioningResume.resumeMultipackHeldOrders).not.toHaveBeenCalled();
  });

  it('should count open orders still holding an older composition', async () => {
    bundles.get.mockResolvedValue({
      variantId: 'v-set',
      version: 3,
      components: [{ variantId: 'v-a', productId: 'p-a', quantity: 1 }],
    });
    inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([
      { productVariantId: 'v-a', availableToPromise: 5 },
    ]);
    availability.getPromisableQuantities.mockResolvedValue([
      { productVariantId: 'v-set', quantity: 5, provenance: 'computed' },
    ]);
    orderRecords.countOpenOrdersByBundleVersion.mockResolvedValue([
      { version: 1, count: 2 },
      { version: 2, count: 1 },
      { version: 3, count: 7 },
    ]);
    const result = await controller.get('v-set');
    expect(result.openOrdersOnOlderComposition).toBe(3);
  });

  it('should list versions newest first with the open orders frozen on each', async () => {
    bundles.history.mockResolvedValue([
      { variantId: 'v-set', version: 1, createdAt: new Date('2026-10-02'), components: [{ variantId: 'v-a', productId: 'p-a', quantity: 1 }] },
      { variantId: 'v-set', version: 2, createdAt: new Date('2026-11-02'), components: [{ variantId: 'v-a', productId: 'p-a', quantity: 2 }] },
    ]);
    orderRecords.countOpenOrdersByBundleVersion.mockResolvedValue([{ version: 1, count: 3 }]);
    const result = await controller.history('v-set');
    expect(result.map((r) => [r.version, r.current, r.openOrders])).toEqual([
      [2, true, 0],
      [1, false, 3],
    ]);
  });

  it('should report no version as current once the bundle was retired', async () => {
    bundles.history.mockResolvedValue([
      { variantId: 'v-set', version: 1, createdAt: new Date('2026-10-02'), retired: true, components: [{ variantId: 'v-a', productId: 'p-a', quantity: 1 }] },
    ]);
    const result = await controller.history('v-set');
    expect(result.map((r) => r.current)).toEqual([false]);
  });

  it('should answer the bundle used-in lookup for several variants in one call, one row per component variant', async () => {
    bundles.findCurrentContainingComponents.mockResolvedValue([
      {
        variantId: 'v-set',
        version: 1,
        components: [
          { variantId: 'v-a', productId: 'p-a', quantity: 1 },
          { variantId: 'v-b', productId: 'p-a', quantity: 2 },
          { variantId: 'v-other', productId: 'p-o', quantity: 1 },
        ],
      },
    ]);
    const result = await controller.usedInMany('v-a, v-b');
    expect(bundles.findCurrentContainingComponents).toHaveBeenCalledTimes(1);
    expect(result.map((r) => r.componentVariantId)).toEqual(['v-a', 'v-b']);
  });

  it('should return the bundle productId on the read', async () => {
    bundles.get.mockResolvedValue({ variantId: 'v-set', version: 1, components: [] });
    products.getVariantsByIds.mockResolvedValue([{ id: 'v-set', productId: 'p-set', sku: 's', price: 1 }]);
    availability.getPromisableQuantities.mockResolvedValue([]);
    inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([]);
    const result = await controller.get('v-set');
    expect(result.productId).toBe('p-set');
  });

  it('should give each component summary the product picture proxy path, or null without one', async () => {
    bundles.get.mockResolvedValue({
      variantId: 'v-set',
      version: 1,
      components: [
        { variantId: 'v-a', productId: 'p-a', quantity: 1 },
        { variantId: 'v-b', productId: 'p-b', quantity: 1 },
      ],
    });
    products.getVariantsByIds.mockResolvedValue([
      { id: 'v-set', productId: 'p-set', sku: 's', price: 1 },
      { id: 'v-a', productId: 'p-a', sku: 'a', price: 1 },
      { id: 'v-b', productId: 'p-b', sku: 'b', price: 1 },
    ]);
    products.getProductsByIds.mockResolvedValue([
      { id: 'p-set', name: 'Set', images: null },
      { id: 'p-a', name: 'A', images: ['http://shop/a.jpg'] },
      { id: 'p-b', name: 'B', images: [] },
    ]);
    availability.getPromisableQuantities.mockResolvedValue([]);
    inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([]);
    const result = await controller.get('v-set');
    const byId = new Map(result.componentAvailability.map((c) => [c.variantId, c.summary.imageUrl]));
    expect(byId.get('v-a')).toBe('/products/p-a/images/0');
    expect(byId.get('v-b')).toBeNull();
  });

  it('should 404 the history of a variant that was never a bundle', async () => {
    bundles.history.mockResolvedValue([]);
    await expect(controller.history('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should answer which bundles hold a product', async () => {
    bundles.findCurrentContainingComponents.mockResolvedValue([
      {
        variantId: 'v-set',
        version: 1,
        components: [{ variantId: 'v-a', productId: 'p-a', quantity: 2, giftSlot: true }],
      },
    ]);
    const result = await controller.usedIn('v-a');
    expect(result).toEqual([
      expect.objectContaining({ bundleVariantId: 'v-set', quantity: 2, giftSlot: true }),
    ]);
  });

  it('should confirm a multipack, then re-drive only the orders held for it', async () => {
    bundles.confirmMultipack.mockResolvedValue(undefined);
    provisioningResume.resumeMultipackHeldOrders.mockResolvedValue({ held: 2, enqueued: 2, notResumed: 0 });
    const result = await controller.confirmMultipack(
      { variantId: 'v-a', packQuantity: 3 },
      { id: 'u1' } as never
    );
    expect(bundles.confirmMultipack).toHaveBeenCalledWith({ variantId: 'v-a', packQuantity: 3 }, 'u1');
    expect(provisioningResume.resumeMultipackHeldOrders).toHaveBeenCalledWith({
      variantId: 'v-a',
      packQuantity: 3,
    });
    expect(result).toEqual({ variantId: 'v-a', packQuantity: 3, releasedOrders: 2 });
  });

  it('should still resume on a second confirmation of the same pair', async () => {
    bundles.confirmMultipack.mockResolvedValue(undefined);
    await controller.confirmMultipack({ variantId: 'v-a', packQuantity: 3 }, { id: 'u1' } as never);
    await controller.confirmMultipack({ variantId: 'v-a', packQuantity: 3 }, { id: 'u1' } as never);
    expect(provisioningResume.resumeMultipackHeldOrders).toHaveBeenCalledTimes(2);
  });

  it('should answer 400 and release nothing for an unknown variant', async () => {
    bundles.confirmMultipack.mockRejectedValue(new BundleDefinitionInvalidError('no such variant'));
    await expect(
      controller.confirmMultipack({ variantId: 'x', packQuantity: 3 }, { id: 'u1' } as never)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(provisioningResume.resumeMultipackHeldOrders).not.toHaveBeenCalled();
  });
});
