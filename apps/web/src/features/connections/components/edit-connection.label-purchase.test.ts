/**
 * Label-purchase notification merge tests (#4097)
 *
 * The flag is nested in `config.shipping`, and the config is replaced whole on
 * save, so the merge must keep every other key: the rest of `config` and the
 * namespace's own siblings.
 *
 * @module features/connections/components
 */
import { describe, expect, it } from 'vitest';
import { mergeStructuredIntoConfig } from './edit-connection.schema';

describe('notifyOnLabelPurchase merge', () => {
  it('should write true into the shipping namespace when turned on', () => {
    const merged = mergeStructuredIntoConfig({}, { notifyOnLabelPurchase: true });
    expect(merged).toEqual({ shipping: { notifyMarketplaceOnLabelPurchase: true } });
  });

  it('should write an explicit false when turned off', () => {
    const merged = mergeStructuredIntoConfig(
      { shipping: { notifyMarketplaceOnLabelPurchase: true } },
      { notifyOnLabelPurchase: false },
    );
    expect(merged).toEqual({ shipping: { notifyMarketplaceOnLabelPurchase: false } });
  });

  it('should keep other config keys and other shipping keys unchanged', () => {
    const base = {
      environment: 'production',
      organizationId: '123',
      senderAddress: { name: 'Shop' },
      shipping: { otherFlag: 'keep', nested: { a: 1 } },
    };
    const merged = mergeStructuredIntoConfig(base, { notifyOnLabelPurchase: true });
    expect(merged).toEqual({
      environment: 'production',
      organizationId: '123',
      senderAddress: { name: 'Shop' },
      shipping: { otherFlag: 'keep', nested: { a: 1 }, notifyMarketplaceOnLabelPurchase: true },
    });
    expect(base.shipping).toEqual({ otherFlag: 'keep', nested: { a: 1 } });
  });

  it('should replace a namespace that is not a plain object', () => {
    for (const shipping of [true, 'on', null, [1]]) {
      const merged = mergeStructuredIntoConfig({ shipping }, { notifyOnLabelPurchase: true });
      expect(merged.shipping).toEqual({ notifyMarketplaceOnLabelPurchase: true });
    }
  });

  it('should leave the shipping namespace untouched when the field is absent', () => {
    const base = { shipping: { notifyMarketplaceOnLabelPurchase: true, otherFlag: 1 } };
    const merged = mergeStructuredIntoConfig(base, { fulfilmentOwnedByDestination: true });
    expect(merged.shipping).toEqual(base.shipping);
  });
});
