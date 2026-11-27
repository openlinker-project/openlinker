/**
 * Amazon setup schema tests (#4186)
 */
import { describe, expect, it } from 'vitest';
import { AMAZON_SETUP_DEFAULT_VALUES, amazonSetupSchema, toCreateConnectionInput } from './amazon-setup.schema';

const valid = {
  ...AMAZON_SETUP_DEFAULT_VALUES,
  name: 'Amazon EU',
  marketplaceIds: ['A1PA6795UKMFR9', 'A1C3SOZRARQ6R3'],
  sellerId: 'a2example12345',
  clientId: 'amzn1.application-oa2-client.abc',
  clientSecret: 'secret',
  refreshToken: 'Atzr|token',
};

function issues(values: typeof valid): Record<string, string> {
  const result = amazonSetupSchema.safeParse(values);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]));
}

describe('amazonSetupSchema', () => {
  it('should accept a sales channel connection and build the create payload', () => {
    const parsed = amazonSetupSchema.parse(valid);

    expect(toCreateConnectionInput(parsed)).toEqual({
      name: 'Amazon EU',
      platformType: 'amazon',
      adapterKey: 'amazon.spapi.v1',
      config: {
        region: 'eu',
        environment: 'production',
        marketplaceIds: ['A1PA6795UKMFR9', 'A1C3SOZRARQ6R3'],
        sellerId: 'A2EXAMPLE12345',
      },
      credentials: { clientId: 'amzn1.application-oa2-client.abc', clientSecret: 'secret', refreshToken: 'Atzr|token' },
      enabledCapabilities: ['OrderSource', 'OfferManager'],
    });
  });

  it('should send the chosen order sync start only when the connection reads orders (#4228)', () => {
    const fromDate = { ...valid, orderSyncStart: { mode: 'from' as const, from: '2026-11-01' } };

    expect(toCreateConnectionInput(amazonSetupSchema.parse(fromDate)).orderSyncStart).toEqual({
      mode: 'from',
      from: '2026-11-01',
    });
    expect(
      toCreateConnectionInput(amazonSetupSchema.parse({ ...fromDate, orders: false })).orderSyncStart,
    ).toBeUndefined();
  });

  it('should refuse a marketplace served by another region', () => {
    expect(issues({ ...valid, region: 'na' })).toMatchObject({ marketplaceIds: 'marketplaceOtherRegion' });
    expect(issues({ ...valid, marketplaceIds: [] })).toMatchObject({ marketplaceIds: 'marketplaceRequired' });
  });

  it('should take one marketplace in the Far East region, where each country is its own account', () => {
    expect(issues({ ...valid, region: 'fe', marketplaceIds: ['A1VC38T7YXB528', 'A39IBJ37TRP1C6'] })).toMatchObject({
      marketplaceIds: 'marketplaceSingle',
    });
    expect(issues({ ...valid, region: 'fe', marketplaceIds: ['A1VC38T7YXB528'] })).toEqual({});
  });

  it('should require the merchant token for offers only', () => {
    expect(issues({ ...valid, sellerId: '' })).toMatchObject({ sellerId: 'sellerIdRequired' });
    expect(issues({ ...valid, sellerId: '', offers: false })).toEqual({});
    expect(issues({ ...valid, sellerId: 'x1' })).toMatchObject({ sellerId: 'sellerIdInvalid' });
  });

  it('should require a role capability, a valid queue URL and both AWS keys together', () => {
    expect(issues({ ...valid, orders: false, offers: false })).toMatchObject({ orders: 'capabilityRequired' });
    expect(issues({ ...valid, notificationQueueUrl: 'https://example.com/q' })).toMatchObject({
      notificationQueueUrl: 'queueUrlInvalid',
    });
    expect(issues({ ...valid, awsAccessKeyId: 'AKIA1' })).toMatchObject({ awsAccessKeyId: 'awsKeysPaired' });
  });

  it('should send the queue and AWS keys when given, and only the chosen capability', () => {
    const parsed = amazonSetupSchema.parse({
      ...valid,
      offers: false,
      notificationQueueUrl: 'https://sqs.eu-west-1.amazonaws.com/123456789012/amazon-notifications',
      awsAccessKeyId: 'AKIAEXAMPLE',
      awsSecretAccessKey: 'aws-secret',
    });
    const input = toCreateConnectionInput(parsed);

    expect(input.enabledCapabilities).toEqual(['OrderSource']);
    expect(input.config).toMatchObject({
      notificationQueueUrl: 'https://sqs.eu-west-1.amazonaws.com/123456789012/amazon-notifications',
    });
    expect(input.credentials).toMatchObject({ awsAccessKeyId: 'AKIAEXAMPLE', awsSecretAccessKey: 'aws-secret' });
  });
});
