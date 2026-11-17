/**
 * parseAmazonConfig tests (#3741 foundation)
 *
 * @module libs/integrations/amazon/src/domain/policies/__tests__
 */
import { parseAmazonConfig, resolveAmazonSpApiHost } from '../amazon-config.policy';

describe('parseAmazonConfig', () => {
  it('should default the region to eu and the environment to production', () => {
    const result = parseAmazonConfig({ marketplaceIds: ['A1PA6795UKMFR9'] });
    expect(result).toEqual({
      ok: true,
      config: { region: 'eu', environment: 'production', marketplaceIds: ['A1PA6795UKMFR9'] },
    });
  });

  it('should accept FR, DE and PL together and drop duplicates', () => {
    const result = parseAmazonConfig({
      region: 'eu',
      environment: 'sandbox',
      marketplaceIds: ['A13V1IB3VIYZZH', 'A1PA6795UKMFR9', 'A1C3SOZRARQ6R3', 'A1PA6795UKMFR9'],
    });
    expect(result.ok && result.config.marketplaceIds).toEqual([
      'A13V1IB3VIYZZH',
      'A1PA6795UKMFR9',
      'A1C3SOZRARQ6R3',
    ]);
  });

  it('should refuse a missing or empty marketplace list', () => {
    for (const marketplaceIds of [undefined, [], 'A1PA6795UKMFR9']) {
      const result = parseAmazonConfig({ marketplaceIds });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.issues[0].path).toBe('marketplaceIds');
    }
  });

  it('should refuse a malformed marketplace id and name its position', () => {
    const result = parseAmazonConfig({ marketplaceIds: ['A1PA6795UKMFR9', 'de'] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map((issue) => issue.path)).toEqual(['marketplaceIds.1']);
  });

  it('should refuse a known marketplace paired with another region', () => {
    const result = parseAmazonConfig({ region: 'na', marketplaceIds: ['A1PA6795UKMFR9'] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0].message).toContain('eu region');
  });

  it('should accept an unknown marketplace id by format alone', () => {
    const result = parseAmazonConfig({ region: 'na', marketplaceIds: ['ATVPDKIKX0DER'] });
    expect(result.ok).toBe(true);
  });

  it('should refuse an unknown region or environment', () => {
    const result = parseAmazonConfig({ region: 'us', environment: 'live', marketplaceIds: ['ATVPDKIKX0DER'] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map((issue) => issue.path)).toEqual(['region', 'environment']);
  });
});

describe('resolveAmazonSpApiHost', () => {
  it('should resolve the regional production and sandbox hosts', () => {
    expect(resolveAmazonSpApiHost({ region: 'eu', environment: 'production' })).toBe(
      'sellingpartnerapi-eu.amazon.com',
    );
    expect(resolveAmazonSpApiHost({ region: 'eu', environment: 'sandbox' })).toBe(
      'sandbox.sellingpartnerapi-eu.amazon.com',
    );
    expect(resolveAmazonSpApiHost({ region: 'fe', environment: 'production' })).toBe(
      'sellingpartnerapi-fe.amazon.com',
    );
  });
});
