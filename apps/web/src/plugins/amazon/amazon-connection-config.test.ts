/**
 * Amazon connection-config contribution tests (#4186)
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { amazonConnectionConfig } from './amazon-connection-config';

const schema = z.object(amazonConnectionConfig.schemaShape as z.ZodRawShape);

describe('amazonConnectionConfig', () => {
  it('should read the stored marketplaces, merchant token and queue', () => {
    expect(
      amazonConnectionConfig.readConfigToForm({
        region: 'eu',
        marketplaceIds: ['A1PA6795UKMFR9', 'A1C3SOZRARQ6R3'],
        sellerId: 'A2EXAMPLE12345',
      }),
    ).toEqual({
      amazonMarketplaceIds: 'A1PA6795UKMFR9,A1C3SOZRARQ6R3',
      amazonSellerId: 'A2EXAMPLE12345',
      amazonNotificationQueueUrl: '',
    });
  });

  it('should write a patch without dropping other keys, and clear with null', () => {
    const config = { region: 'eu', environment: 'sandbox', marketplaceIds: ['A1PA6795UKMFR9'], sellerId: 'OLD12345' };

    expect(amazonConnectionConfig.applyToConfig(config, { amazonMarketplaceIds: 'A1PA6795UKMFR9,A13V1IB3VIYZZH' })).toEqual({
      ...config,
      marketplaceIds: ['A1PA6795UKMFR9', 'A13V1IB3VIYZZH'],
    });
    expect(amazonConnectionConfig.applyToConfig(config, { amazonSellerId: ' a2new1234 ' })).toMatchObject({
      sellerId: 'A2NEW1234',
    });
    expect(amazonConnectionConfig.applyToConfig(config, { amazonSellerId: '' })).toMatchObject({ sellerId: null });
    expect(amazonConnectionConfig.applyToConfig(config, { amazonNotificationQueueUrl: '' })).toMatchObject({
      notificationQueueUrl: null,
    });
  });

  it('should refuse no marketplace, a malformed token and a queue URL that is not SQS', () => {
    expect(schema.safeParse({ amazonMarketplaceIds: '' }).success).toBe(false);
    expect(schema.safeParse({ amazonSellerId: 'x1' }).success).toBe(false);
    expect(schema.safeParse({ amazonNotificationQueueUrl: 'https://example.com/q' }).success).toBe(false);
    expect(
      schema.safeParse({
        amazonMarketplaceIds: 'A1PA6795UKMFR9',
        amazonSellerId: '',
        amazonNotificationQueueUrl: 'https://sqs.eu-west-1.amazonaws.com/123456789012/amazon-notifications',
      }).success,
    ).toBe(true);
  });

  it('should refuse two marketplaces of a region with a seller account per country', () => {
    expect(schema.safeParse({ amazonMarketplaceIds: 'A1VC38T7YXB528,A39IBJ37TRP1C6' }).success).toBe(false);
    expect(schema.safeParse({ amazonMarketplaceIds: 'A1VC38T7YXB528' }).success).toBe(true);
    expect(schema.safeParse({ amazonMarketplaceIds: 'A1PA6795UKMFR9,A1C3SOZRARQ6R3' }).success).toBe(true);
  });
});
