/**
 * Amazon test seam: base-URL overrides for the automated E2E fake server.
 */
import { amazonTestOverride, resolveAmazonLwaUrl, AMAZON_LWA_TOKEN_URL } from './amazon.constants';
import { resolveAmazonSpApiHost } from './domain/policies/amazon-config.policy';
import { buildAmazonUrl } from './infrastructure/http/amazon-spapi-client';

describe('Amazon test seam', () => {
  const cfg = { region: 'eu', environment: 'production' } as const;

  it('should use the hardcoded hosts when no override is set', () => {
    expect(resolveAmazonSpApiHost(cfg, {})).toBe('sellingpartnerapi-eu.amazon.com');
    expect(resolveAmazonLwaUrl({})).toBe(AMAZON_LWA_TOKEN_URL);
  });

  it('should prefer the override when it is set outside production', () => {
    const env = { OL_AMAZON_SPAPI_BASE_URL_EU: 'http://fake:4101', OL_AMAZON_LWA_URL: 'http://fake:4100' };
    expect(resolveAmazonSpApiHost(cfg, env)).toBe('http://fake:4101');
    expect(resolveAmazonSpApiHost({ region: 'na', environment: 'production' }, env)).toBe('sellingpartnerapi-na.amazon.com');
    expect(resolveAmazonLwaUrl(env)).toBe('http://fake:4100/auth/o2/token');
    expect(buildAmazonUrl('http://fake:4101', '/orders/x', { a: 1 })).toBe('http://fake:4101/orders/x?a=1');
  });

  it('should ignore every override when NODE_ENV is production', () => {
    const env = { NODE_ENV: 'production', OL_AMAZON_SPAPI_BASE_URL_EU: 'http://evil:1', OL_AMAZON_LWA_URL: 'http://evil:2' };
    expect(resolveAmazonSpApiHost(cfg, env)).toBe('sellingpartnerapi-eu.amazon.com');
    expect(resolveAmazonLwaUrl(env)).toBe(AMAZON_LWA_TOKEN_URL);
    expect(amazonTestOverride('OL_AMAZON_LWA_URL', env)).toBeNull();
  });

  it('should ignore a malformed override', () => {
    expect(amazonTestOverride('X', { X: 'ftp://a' })).toBeNull();
    expect(amazonTestOverride('X', { X: 'http://a/path' })).toBeNull();
  });
});
