/**
 * parseAmazonCredentials tests (#3741 foundation)
 *
 * @module libs/integrations/amazon/src/domain/policies/__tests__
 */
import { parseAmazonCredentials } from '../amazon-credentials.policy';

const VALID = { clientId: 'amzn1.application-oa2-client.x', clientSecret: 'secret', refreshToken: 'Atzr|token' };

describe('parseAmazonCredentials', () => {
  it('should read a pasted private-app token as self-authorized', () => {
    const result = parseAmazonCredentials(VALID);
    expect(result.ok && result.source).toBe('self-authorized');
    expect(result.ok && result.credentials.refreshToken).toBe('Atzr|token');
  });

  it('should keep an oauth source and the selling partner id', () => {
    const result = parseAmazonCredentials({ ...VALID, source: 'oauth', sellingPartnerId: 'A2SELLER' });
    expect(result.ok && result.source).toBe('oauth');
    expect(result.ok && result.credentials.sellingPartnerId).toBe('A2SELLER');
  });

  it('should trim the three values', () => {
    const result = parseAmazonCredentials({ clientId: ' id ', clientSecret: ' s ', refreshToken: ' t ' });
    expect(result.ok && result.credentials).toMatchObject({ clientId: 'id', clientSecret: 's', refreshToken: 't' });
  });

  it('should name every missing value and never echo one back', () => {
    const result = parseAmazonCredentials({ clientSecret: 'super-secret', refreshToken: '  ' });
    expect(result.ok).toBe(false);
    const issues = result.ok ? [] : result.issues;
    expect(issues).toEqual([
      'must include a non-empty `clientId` string',
      'must include a non-empty `refreshToken` string',
    ]);
    expect(issues.join(' ')).not.toContain('super-secret');
  });

  it('should refuse an unknown source', () => {
    const result = parseAmazonCredentials({ ...VALID, source: 'iam' });
    expect(result.ok).toBe(false);
  });
});

describe('parseAmazonCredentials AWS key (#4179)', () => {
  it('should keep an AWS key pair', () => {
    const result = parseAmazonCredentials({ ...VALID, awsAccessKeyId: 'AKIA', awsSecretAccessKey: 's' });
    expect(result.ok && result.credentials).toMatchObject({ awsAccessKeyId: 'AKIA', awsSecretAccessKey: 's' });
  });

  it('should refuse half an AWS key pair', () => {
    expect(parseAmazonCredentials({ ...VALID, awsAccessKeyId: 'AKIA' }).ok).toBe(false);
  });
});
