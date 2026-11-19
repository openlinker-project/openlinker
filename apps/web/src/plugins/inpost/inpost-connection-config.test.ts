/**
 * InPost connection-config contribution tests (#4134)
 *
 * @module plugins/inpost
 */
import { describe, expect, it } from 'vitest';
import { inpostConnectionConfig } from './inpost-connection-config';

describe('inpostConnectionConfig', () => {
  it('should hydrate "never chosen" when the key is absent', () => {
    expect(inpostConnectionConfig.readConfigToForm({})).toEqual({
      inpostNotifyOnLabelPurchase: '',
    });
    expect(inpostConnectionConfig.readConfigToForm({ shipping: { other: 1 } })).toEqual({
      inpostNotifyOnLabelPurchase: '',
    });
  });

  it('should hydrate true and false', () => {
    const read = (value: boolean): unknown =>
      inpostConnectionConfig.readConfigToForm({
        shipping: { notifyMarketplaceOnLabelPurchase: value },
      });
    expect(read(true)).toEqual({ inpostNotifyOnLabelPurchase: 'true' });
    expect(read(false)).toEqual({ inpostNotifyOnLabelPurchase: 'false' });
  });

  it('should leave the config untouched while nothing is chosen', () => {
    const config = { environment: 'sandbox' };
    const next = inpostConnectionConfig.applyToConfig(config, { inpostNotifyOnLabelPurchase: '' });
    expect(next).toEqual(config);
    expect('shipping' in next).toBe(false);
  });

  it('should write true, then an explicit false, keeping sibling keys', () => {
    const on = inpostConnectionConfig.applyToConfig(
      { environment: 'sandbox', shipping: { keep: 'me' } },
      { inpostNotifyOnLabelPurchase: 'true' },
    );
    expect(on).toEqual({
      environment: 'sandbox',
      shipping: { keep: 'me', notifyMarketplaceOnLabelPurchase: true },
    });
    const off = inpostConnectionConfig.applyToConfig(on, { inpostNotifyOnLabelPurchase: 'false' });
    expect(off.shipping).toEqual({ keep: 'me', notifyMarketplaceOnLabelPurchase: false });
  });
});
