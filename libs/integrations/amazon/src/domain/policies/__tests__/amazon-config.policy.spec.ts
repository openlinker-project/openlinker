/**
 * parseAmazonConfig tests (#3741 foundation)
 *
 * @module libs/integrations/amazon/src/domain/policies/__tests__
 */
import {
  environmentChangeIssue,
  fixedAccountIssues,
  parseAmazonConfig,
  regionChangeIssue,
  singleMarketplaceChangeIssue,
  resolveAmazonSpApiHost,
  resolveCatalogueMarketplaceId,
} from '../amazon-config.policy';

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

  it('should refuse the US marketplace on a European connection, and accept it on North America', () => {
    const eu = parseAmazonConfig({ region: 'eu', marketplaceIds: ['ATVPDKIKX0DER'] });
    expect(!eu.ok && eu.issues[0].message).toContain('na region');
    expect(parseAmazonConfig({ region: 'na', marketplaceIds: ['ATVPDKIKX0DER'] }).ok).toBe(true);
  });

  it('should accept an unknown marketplace id by format alone', () => {
    const result = parseAmazonConfig({ region: 'eu', marketplaceIds: ['A9NEWMARKET01'] });
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

describe('parseAmazonConfig notification queue (#4179)', () => {
  it('should read the region and ARN from an SQS queue URL', () => {
    const result = parseAmazonConfig({
      marketplaceIds: ['A1PA6795UKMFR9'],
      notificationQueueUrl: 'https://sqs.eu-west-1.amazonaws.com/123456789012/amazon-notifications',
    });
    expect(result.ok && result.config.notificationQueue).toEqual({
      url: 'https://sqs.eu-west-1.amazonaws.com/123456789012/amazon-notifications',
      region: 'eu-west-1',
      arn: 'arn:aws:sqs:eu-west-1:123456789012:amazon-notifications',
    });
  });

  it('should treat an empty queue URL as no queue', () => {
    const result = parseAmazonConfig({ marketplaceIds: ['A1PA6795UKMFR9'], notificationQueueUrl: '' });
    expect(result.ok && result.config.notificationQueue).toBeUndefined();
  });

  it('should refuse a URL that is not an SQS queue', () => {
    const result = parseAmazonConfig({ marketplaceIds: ['A1PA6795UKMFR9'], notificationQueueUrl: 'https://example.com/q' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0].path).toBe('notificationQueueUrl');
  });
});

describe('parseAmazonConfig sellerId (#4180)', () => {
  it('should keep a merchant token', () => {
    const result = parseAmazonConfig({ marketplaceIds: ['A1PA6795UKMFR9'], sellerId: ' A2SELLER123 ' });
    expect(result.ok && result.config.sellerId).toBe('A2SELLER123');
  });

  it('should refuse something that is not a merchant token', () => {
    const result = parseAmazonConfig({ marketplaceIds: ['A1PA6795UKMFR9'], sellerId: 'my shop' });
    expect(!result.ok && result.issues[0].path).toBe('sellerId');
  });
});

describe('parseAmazonConfig single-marketplace regions', () => {
  it('should refuse two Far East marketplaces on one connection', () => {
    const result = parseAmazonConfig({ region: 'fe', marketplaceIds: ['A1VC38T7YXB528', 'A39IBJ37TRP1C6'] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map((issue) => issue.path)).toEqual(['marketplaceIds']);
  });

  it('should accept one Far East marketplace', () => {
    expect(parseAmazonConfig({ region: 'fe', marketplaceIds: ['A1VC38T7YXB528'] }).ok).toBe(true);
  });

  it('should keep several marketplaces allowed in a unified region', () => {
    const result = parseAmazonConfig({ region: 'na', marketplaceIds: ['ATVPDKIKX0DER', 'A2EUQ1WTGCTBG2'] });
    expect(result.ok).toBe(true);
  });
});

describe('regionChangeIssue', () => {
  it('should refuse a move to another region', () => {
    expect(regionChangeIssue({ region: 'na' }, { region: 'eu' })?.path).toBe('region');
  });

  it('should read a stored config without a region as the default region', () => {
    expect(regionChangeIssue({ region: 'eu' }, {})).toBeNull();
    expect(regionChangeIssue({ region: 'fe' }, {})?.path).toBe('region');
  });

  it('should pass a save that keeps the region', () => {
    expect(regionChangeIssue({ region: 'na', sellerId: 'A2EXAMPLE12345' }, { region: 'na' })).toBeNull();
  });
});

describe('environmentChangeIssue', () => {
  it('should refuse a move from sandbox to production', () => {
    expect(environmentChangeIssue({ environment: 'production' }, { environment: 'sandbox' })?.path).toBe('environment');
  });

  it('should read a stored config without an environment as production', () => {
    expect(environmentChangeIssue({ environment: 'production' }, {})).toBeNull();
    expect(environmentChangeIssue({ environment: 'sandbox' }, {})?.path).toBe('environment');
  });
});

describe('singleMarketplaceChangeIssue', () => {
  const JP = 'A1VC38T7YXB528';
  const AU = 'A39IBJ37TRP1C6';

  it('should refuse swapping the marketplace in the fe region', () => {
    expect(singleMarketplaceChangeIssue({ region: 'fe', marketplaceIds: [AU] }, { region: 'fe', marketplaceIds: [JP] })?.path).toBe(
      'marketplaceIds',
    );
  });

  it('should pass a save that keeps the fe marketplace', () => {
    expect(singleMarketplaceChangeIssue({ region: 'fe', marketplaceIds: [JP] }, { region: 'fe', marketplaceIds: [JP] })).toBeNull();
  });

  it('should leave a unified region free to change its marketplaces', () => {
    expect(
      singleMarketplaceChangeIssue(
        { region: 'na', marketplaceIds: ['A2EUQ1WTGCTBG2'] },
        { region: 'na', marketplaceIds: ['ATVPDKIKX0DER'] },
      ),
    ).toBeNull();
  });
});

describe('fixedAccountIssues', () => {
  it('should report every account field that changed', () => {
    const issues = fixedAccountIssues(
      { region: 'na', environment: 'production', marketplaceIds: ['ATVPDKIKX0DER'] },
      { region: 'eu', environment: 'sandbox', marketplaceIds: ['A1PA6795UKMFR9'] },
    );
    expect(issues.map((issue) => issue.path)).toEqual(['region', 'environment']);
  });
});

describe('parseAmazonConfig taxCodeRates (#4182)', () => {
  it('should store codes in upper case and rates in their canonical spelling', () => {
    const result = parseAmazonConfig({
      marketplaceIds: ['A1PA6795UKMFR9'],
      taxCodeRates: { a_gen_standard: '23.00', A_BOOKS_GEN: ' 5 ', A_EXEMPT: 'ZW' },
    });
    expect(result.ok && result.config.taxCodeRates).toEqual({ A_GEN_STANDARD: '23', A_BOOKS_GEN: '5', A_EXEMPT: 'zw' });
  });

  it('should refuse a rate outside the vocabulary', () => {
    const result = parseAmazonConfig({ marketplaceIds: ['A1PA6795UKMFR9'], taxCodeRates: { A_GEN_STANDARD: '23%' } });
    expect(!result.ok && result.issues.map((issue) => issue.path)).toEqual(['taxCodeRates.A_GEN_STANDARD']);
  });
});

describe('catalogueMarketplaceId (#4182)', () => {
  const DE = 'A1PA6795UKMFR9';
  const PL = 'A1C3SOZRARQ6R3';

  it('should read the catalogue from the chosen marketplace, else the first', () => {
    const chosen = parseAmazonConfig({ marketplaceIds: [DE, PL], catalogueMarketplaceId: PL });
    expect(chosen.ok && resolveCatalogueMarketplaceId(chosen.config)).toBe(PL);
    const unset = parseAmazonConfig({ marketplaceIds: [DE, PL], catalogueMarketplaceId: null });
    expect(unset.ok && resolveCatalogueMarketplaceId(unset.config)).toBe(DE);
  });

  it('should refuse a catalogue marketplace the connection does not sell on', () => {
    const result = parseAmazonConfig({ marketplaceIds: [DE], catalogueMarketplaceId: PL });
    expect(!result.ok && result.issues.map((issue) => issue.path)).toEqual(['catalogueMarketplaceId']);
  });
});

describe('parseAmazonConfig fbaLocationId (#4183)', () => {
  const base = { marketplaceIds: ['A1PA6795UKMFR9'] };

  it('should keep a FBA location next to a different seller-fulfilled location', () => {
    const result = parseAmazonConfig({ ...base, fbaLocationId: 'ol_location_fba', stockLocationOverride: 'ol_location_main' });
    expect(result.ok && result.config.fbaLocationId).toBe('ol_location_fba');
  });

  it('should treat an empty FBA location as FBA off', () => {
    const result = parseAmazonConfig({ ...base, fbaLocationId: null });
    expect(result.ok && result.config.fbaLocationId).toBeUndefined();
  });

  it('should refuse a FBA location without a seller-fulfilled location', () => {
    const result = parseAmazonConfig({ ...base, fbaLocationId: 'ol_location_fba' });
    expect(!result.ok && result.issues[0].path).toBe('fbaLocationId');
  });

  it('should refuse the same location for FBA and seller-fulfilled stock', () => {
    const result = parseAmazonConfig({ ...base, fbaLocationId: 'ol_location_x', stockLocationOverride: 'ol_location_x' });
    expect(!result.ok && result.issues[0].path).toBe('fbaLocationId');
  });
});
