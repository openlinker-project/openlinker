import { hasBundleDefinition } from '../multipack-hold';

function bundles(over: { current?: unknown[]; confirmed?: unknown[] } = {}) {
  return {
    findCurrentByVariantIds: jest.fn().mockResolvedValue(over.current ?? []),
    findConfirmedMultipacks: jest.fn().mockResolvedValue(over.confirmed ?? []),
  };
}

describe('hasBundleDefinition (#3607, #3624)', () => {
  it('should be true when the variant has a current definition, without asking about confirmations', async () => {
    const b = bundles({ current: [{ variantId: 'v1', version: 1, components: [] }] });
    await expect(hasBundleDefinition(b, 'v1', 3)).resolves.toBe(true);
    expect(b.findConfirmedMultipacks).not.toHaveBeenCalled();
  });

  it('should be true when the operator confirmed this variant at this pack quantity', async () => {
    const b = bundles({ confirmed: [{ variantId: 'v1', packQuantity: 3 }] });
    await expect(hasBundleDefinition(b, 'v1', 3)).resolves.toBe(true);
    expect(b.findConfirmedMultipacks).toHaveBeenCalledWith([{ variantId: 'v1', packQuantity: 3 }]);
  });

  it('should be false for an unconfirmed pack quantity and for a line with no pack quantity', async () => {
    await expect(hasBundleDefinition(bundles(), 'v1', 3)).resolves.toBe(false);
    const b = bundles();
    await expect(hasBundleDefinition(b, 'v1')).resolves.toBe(false);
    expect(b.findConfirmedMultipacks).not.toHaveBeenCalled();
  });

  it('should be false, without a lookup, for a line with no variant', async () => {
    const b = bundles();
    await expect(hasBundleDefinition(b, undefined, 3)).resolves.toBe(false);
    expect(b.findCurrentByVariantIds).not.toHaveBeenCalled();
  });
});
