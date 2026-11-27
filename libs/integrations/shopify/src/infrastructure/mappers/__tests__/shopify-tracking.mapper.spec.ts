import { buildShopifyTrackingInfo } from '../shopify-tracking.mapper';

describe('buildShopifyTrackingInfo', () => {
  it('should send a known carrier with its own tracking page', () => {
    expect(buildShopifyTrackingInfo(' 6200123456 ', 'inpost')).toEqual({
      number: '6200123456',
      company: 'InPost',
      url: 'https://inpost.pl/sledzenie-przesylek?number=6200123456',
    });
    expect(buildShopifyTrackingInfo('0000123', 'dpd')).toMatchObject({ company: 'DPD' });
  });

  it('should always send a url, so Shopify does not guess the carrier from the number (L-F3)', () => {
    for (const carrier of [undefined, 'some-other-carrier']) {
      const info = buildShopifyTrackingInfo('ABC 123', carrier);

      expect(info).toEqual({
        number: 'ABC 123',
        company: 'Other',
        url: 'https://parcelsapp.com/en/tracking/ABC%20123',
      });
    }
  });
});
