import {
  resolveShopifyCredentialMode,
  shopifyCredentialFingerprint,
} from '../shopify-credentials.policy';

describe('resolveShopifyCredentialMode', () => {
  it.each([
    [{ accessToken: 'shpat_x' }, 'access-token'],
    [{ clientId: 'id', clientSecret: 'secret' }, 'client-credentials'],
    [{ accessToken: 'shpat_x', clientId: 'id', clientSecret: 'secret' }, 'access-token'],
    [
      { grant: 'oauth', accessToken: 't', refreshToken: 'r', clientId: 'id', clientSecret: 's' },
      'oauth',
    ],
  ])('should read %p as %s', (credentials, mode) => {
    expect(resolveShopifyCredentialMode(credentials)).toBe(mode);
  });

  it.each([
    [{}],
    [{ clientId: 'id' }],
    [{ accessToken: '   ' }],
    [{ grant: 'oauth', accessToken: 't', clientId: 'id', clientSecret: 's' }],
  ])('should report no usable mode for %p', (credentials) => {
    expect(resolveShopifyCredentialMode(credentials)).toBeNull();
  });
});

describe('shopifyCredentialFingerprint', () => {
  it('should change when the client secret is rotated', () => {
    expect(shopifyCredentialFingerprint({ clientId: 'id', clientSecret: 'a' })).not.toBe(
      shopifyCredentialFingerprint({ clientId: 'id', clientSecret: 'b' }),
    );
  });
});
