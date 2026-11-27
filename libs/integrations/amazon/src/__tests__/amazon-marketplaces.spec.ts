/**
 * Amazon marketplace table tests
 *
 * @module libs/integrations/amazon/src/__tests__
 */
import { AMAZON_KNOWN_MARKETPLACES, AmazonRegionValues } from '../amazon.constants';

describe('AMAZON_KNOWN_MARKETPLACES', () => {
  it('should give every marketplace a region, a country, an ISO currency and a language', () => {
    for (const [id, marketplace] of Object.entries(AMAZON_KNOWN_MARKETPLACES)) {
      expect(id).toMatch(/^[A-Z0-9]{10,14}$/);
      expect(AmazonRegionValues).toContain(marketplace.region);
      expect(marketplace.country).toMatch(/^[A-Z]{2}$/);
      expect(marketplace.currency).toMatch(/^[A-Z]{3}$/);
      expect(marketplace.languageTag).toMatch(/^[a-z]{2}_[A-Z]{2}$/);
    }
  });

  it('should cover every region', () => {
    const regions = new Set(Object.values(AMAZON_KNOWN_MARKETPLACES).map((marketplace) => marketplace.region));
    expect([...regions].sort()).toEqual([...AmazonRegionValues].sort());
  });

  it('should price the US marketplace in dollars and Poland in zloty', () => {
    expect(AMAZON_KNOWN_MARKETPLACES.ATVPDKIKX0DER).toMatchObject({ country: 'US', region: 'na', currency: 'USD' });
    expect(AMAZON_KNOWN_MARKETPLACES.A1C3SOZRARQ6R3).toMatchObject({ country: 'PL', region: 'eu', currency: 'PLN' });
  });
});
