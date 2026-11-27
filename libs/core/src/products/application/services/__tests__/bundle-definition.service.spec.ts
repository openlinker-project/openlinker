/**
 * Bundle Definition Service tests (#3607): nesting is refused both ways, with a named error.
 */
import {
  BundleDefinitionAlreadyExistsError,
  BundleDefinitionInvalidError,
  BundleNestingError,
} from '../../../domain/exceptions/bundle-definition.errors';
import type { BundleDefinition } from '../../../domain/types/bundle.types';
import { BundleDefinitionService } from '../bundle-definition.service';

const variants = ['v-set', 'v-a', 'v-b', 'v-set2'].map((id) => ({ id, productId: `p-${id}` }));

describe('BundleDefinitionService', () => {
  let bundles: {
    findCurrentByVariantIds: jest.Mock;
    findCurrentContainingComponent: jest.Mock;
    insertNextVersion: jest.Mock;
    retire: jest.Mock;
    withVariantsLocked: jest.Mock;
  };
  let service: BundleDefinitionService;

  beforeEach(() => {
    bundles = {
      findCurrentByVariantIds: jest.fn().mockResolvedValue([]),
      findCurrentContainingComponent: jest.fn().mockResolvedValue([]),
      insertNextVersion: jest
        .fn()
        .mockImplementation((variantId: string, components: BundleDefinition['components']) =>
          Promise.resolve({ variantId, version: 1, components })
        ),
      retire: jest.fn(),
      withVariantsLocked: jest.fn(),
    };
    const variantRepo = {
      findByIdIn: jest
        .fn()
        .mockImplementation((ids: string[]) =>
          Promise.resolve(variants.filter((v) => ids.includes(v.id)))
        ),
    };
    bundles.withVariantsLocked = jest.fn().mockImplementation((_ids: string[], work: () => Promise<unknown>) => work());
    service = new BundleDefinitionService(bundles as never, variantRepo as never);
  });

  it('should resolve each component productId from the variant, not from the caller', async () => {
    const created = await service.create('v-set', [{ variantId: 'v-a', quantity: 2, giftSlot: true }]);
    expect(created.components).toEqual([
      { variantId: 'v-a', productId: 'p-v-a', quantity: 2, giftSlot: true },
    ]);
  });

  it('should merge a variant listed twice into ONE component and keep the gift flag only when every slot was a gift (#3520)', async () => {
    const created = await service.create('v-set', [
      { variantId: 'v-a', quantity: 1 },
      { variantId: 'v-a', quantity: 2, giftSlot: true },
      { variantId: 'v-b', quantity: 1, giftSlot: true },
      { variantId: 'v-b', quantity: 1, giftSlot: true },
    ]);
    expect(created.components).toEqual([
      { variantId: 'v-a', productId: 'p-v-a', quantity: 3 },
      { variantId: 'v-b', productId: 'p-v-b', quantity: 2, giftSlot: true },
    ]);
  });

  it('should run the write under a lock on the bundle and every component (#3520)', async () => {
    await service.create('v-set', [{ variantId: 'v-a', quantity: 1 }]);
    expect(bundles.withVariantsLocked).toHaveBeenCalledWith(['v-set', 'v-a'], expect.any(Function));
  });

  it('should refuse a component that is itself a bundle', async () => {
    bundles.findCurrentByVariantIds.mockResolvedValueOnce([]); // create's existence check
    bundles.findCurrentByVariantIds.mockResolvedValueOnce([
      { variantId: 'v-a', version: 1, components: [] },
    ]);
    await expect(service.create('v-set', [{ variantId: 'v-a', quantity: 1 }])).rejects.toMatchObject({
      name: 'BundleNestingError',
      reason: 'component-is-bundle',
    });
    expect(bundles.insertNextVersion).not.toHaveBeenCalled();
  });

  it('should refuse a variant that is already a component of another bundle', async () => {
    bundles.findCurrentContainingComponent.mockResolvedValue([
      { variantId: 'v-set2', version: 1, components: [] },
    ]);
    await expect(service.create('v-set', [{ variantId: 'v-a', quantity: 1 }])).rejects.toBeInstanceOf(
      BundleNestingError
    );
  });

  it('should refuse a self-reference, an empty set, a bad quantity and an unknown variant', async () => {
    await expect(service.create('v-set', [{ variantId: 'v-set', quantity: 1 }])).rejects.toMatchObject({
      reason: 'component-is-self',
    });
    await expect(service.create('v-set', [])).rejects.toBeInstanceOf(BundleDefinitionInvalidError);
    await expect(service.create('v-set', [{ variantId: 'v-a', quantity: 0 }])).rejects.toBeInstanceOf(
      BundleDefinitionInvalidError
    );
    await expect(
      service.create('v-set', [{ variantId: 'v-missing', quantity: 1 }])
    ).rejects.toBeInstanceOf(BundleDefinitionInvalidError);
  });

  it('should refuse a second create for a variant that already has a definition', async () => {
    bundles.findCurrentByVariantIds.mockResolvedValue([{ variantId: 'v-set', version: 1, components: [] }]);
    await expect(service.create('v-set', [{ variantId: 'v-a', quantity: 1 }])).rejects.toBeInstanceOf(
      BundleDefinitionAlreadyExistsError
    );
  });
});

describe('BundleDefinitionService multipack confirmation (#3624)', () => {
  const make = (variants: unknown[]): { service: BundleDefinitionService; bundles: Record<string, jest.Mock> } => {
    const bundles = {
      confirmMultipack: jest.fn().mockResolvedValue(undefined),
      findConfirmedMultipacks: jest.fn().mockResolvedValue([]),
    };
    const variantRepo = { findByIdIn: jest.fn().mockResolvedValue(variants) };
    return { service: new BundleDefinitionService(bundles as never, variantRepo as never), bundles };
  };

  it('should record a confirmation for an existing variant', async () => {
    const { service, bundles } = make([{ id: 'v1' }]);
    await service.confirmMultipack({ variantId: 'v1', packQuantity: 3 }, 'u1');
    expect(bundles.confirmMultipack).toHaveBeenCalledWith({ variantId: 'v1', packQuantity: 3 }, 'u1');
  });

  it('should refuse a pack quantity below 2 and an unknown variant', async () => {
    await expect(make([{ id: 'v1' }]).service.confirmMultipack({ variantId: 'v1', packQuantity: 1 }, null)).rejects.toThrow();
    await expect(make([]).service.confirmMultipack({ variantId: 'v1', packQuantity: 3 }, null)).rejects.toThrow();
  });
});
