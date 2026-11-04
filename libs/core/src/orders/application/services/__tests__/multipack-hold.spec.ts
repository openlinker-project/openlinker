import { hasBundleDefinition } from '../multipack-hold';

describe('hasBundleDefinition (#3607)', () => {
  it('should be true only when the variant has a current definition', async () => {
    const bundles = {
      findCurrentByVariantIds: jest
        .fn()
        .mockResolvedValueOnce([{ variantId: 'v1', version: 1, components: [] }])
        .mockResolvedValueOnce([]),
    };
    await expect(hasBundleDefinition(bundles, 'v1')).resolves.toBe(true);
    await expect(hasBundleDefinition(bundles, 'v2')).resolves.toBe(false);
  });

  it('should be false, without a lookup, for a line with no variant', async () => {
    const bundles = { findCurrentByVariantIds: jest.fn() };
    await expect(hasBundleDefinition(bundles, undefined)).resolves.toBe(false);
    expect(bundles.findCurrentByVariantIds).not.toHaveBeenCalled();
  });
});
