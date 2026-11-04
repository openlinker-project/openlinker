import { ConflictException, NotFoundException } from '@nestjs/common';
import { BundleNestingError } from '@openlinker/core/products';
import { BundleDefinitionsController } from './bundle-definitions.controller';

describe('BundleDefinitionsController (#3607)', () => {
  const bundles = {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    get: jest.fn(),
    list: jest.fn(),
  };
  const inventoryQuery = { getAvailabilityByVariantIds: jest.fn() };
  const availability = { getPromisableQuantities: jest.fn() };
  const controller = new BundleDefinitionsController(
    bundles as never,
    inventoryQuery as never,
    availability as never
  );

  beforeEach(() => jest.resetAllMocks());

  it('should answer nesting as 409 with a machine-readable code', async () => {
    bundles.create.mockRejectedValue(new BundleNestingError('component-is-bundle', 'v1', 'v2'));
    await expect(
      controller.create({ variantId: 'v1', components: [{ variantId: 'v2', quantity: 1 }] })
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      controller.create({ variantId: 'v1', components: [{ variantId: 'v2', quantity: 1 }] })
    ).rejects.toMatchObject({ response: { code: 'BUNDLE_NESTING_REFUSED' } });
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
});
