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
      amazonTaxCodeRates: '',
      amazonCatalogueMarketplaceId: '',
      amazonFbaLocationId: '',
      amazonFbmLocationId: '',
      amazonRefundsEnabled: 'false',
      amazonMcfShippingSpeed: '',
    });
  });

  it('should read and write the refund opt-in (#4184)', () => {
    const config = { region: 'eu', marketplaceIds: ['A1PA6795UKMFR9'], refundsEnabled: true };

    expect(amazonConnectionConfig.readConfigToForm(config)).toMatchObject({ amazonRefundsEnabled: 'true' });
    expect(amazonConnectionConfig.applyToConfig(config, { amazonRefundsEnabled: 'false' })).toMatchObject({
      refundsEnabled: false,
    });
  });

  it('should read, write and clear the FBA location (#4183)', () => {
    const config = { region: 'eu', marketplaceIds: ['A1PA6795UKMFR9'], fbaLocationId: 'ol_location_fba' };

    expect(amazonConnectionConfig.readConfigToForm(config)).toMatchObject({ amazonFbaLocationId: 'ol_location_fba' });
    expect(amazonConnectionConfig.applyToConfig(config, { amazonFbaLocationId: 'ol_location_b' })).toMatchObject({
      fbaLocationId: 'ol_location_b',
    });
    expect(amazonConnectionConfig.applyToConfig(config, { amazonFbaLocationId: '' })).toMatchObject({
      fbaLocationId: null,
    });
  });

  it('should read and write the seller-shipped stock location as stockLocationOverride (#4183)', () => {
    const config = { region: 'eu', marketplaceIds: ['A1PA6795UKMFR9'], stockLocationOverride: 'ol_location_main' };

    expect(amazonConnectionConfig.readConfigToForm(config)).toMatchObject({ amazonFbmLocationId: 'ol_location_main' });
    expect(amazonConnectionConfig.applyToConfig(config, { amazonFbmLocationId: 'ol_location_b' })).toMatchObject({
      stockLocationOverride: 'ol_location_b',
    });
    expect(amazonConnectionConfig.applyToConfig(config, { amazonFbmLocationId: '' })).toMatchObject({
      stockLocationOverride: null,
    });
  });

  it('should read and write the tax code rates as one CODE=rate per line', () => {
    expect(
      amazonConnectionConfig.readConfigToForm({ marketplaceIds: [], taxCodeRates: { A_GEN_STANDARD: '23', A_BOOKS_GEN: '5' } })
        .amazonTaxCodeRates,
    ).toBe('A_GEN_STANDARD=23\nA_BOOKS_GEN=5');
    expect(
      amazonConnectionConfig.applyToConfig({}, { amazonTaxCodeRates: 'a_gen_standard=23.00\n=\nA_EXEMPT=ZW' }),
    ).toEqual({ taxCodeRates: { A_GEN_STANDARD: '23', A_EXEMPT: 'zw' } });
    expect(amazonConnectionConfig.applyToConfig({ taxCodeRates: { A: '23' } }, { amazonTaxCodeRates: '' })).toEqual({
      taxCodeRates: null,
    });
  });

  it('should write the catalogue marketplace, and null for the first one', () => {
    expect(amazonConnectionConfig.applyToConfig({}, { amazonCatalogueMarketplaceId: 'A1C3SOZRARQ6R3' })).toEqual({
      catalogueMarketplaceId: 'A1C3SOZRARQ6R3',
    });
    expect(amazonConnectionConfig.applyToConfig({ catalogueMarketplaceId: 'X' }, { amazonCatalogueMarketplaceId: '' })).toEqual({
      catalogueMarketplaceId: null,
    });
  });

  it('should refuse a tax code row without a valid rate, and allow a row still being added', () => {
    expect(schema.safeParse({ amazonTaxCodeRates: 'A_GEN_STANDARD=' }).success).toBe(false);
    expect(schema.safeParse({ amazonTaxCodeRates: 'A_GEN_STANDARD=23%' }).success).toBe(false);
    expect(schema.safeParse({ amazonTaxCodeRates: '=23' }).success).toBe(false);
    expect(schema.safeParse({ amazonTaxCodeRates: 'A_GEN_STANDARD=23\n=' }).success).toBe(true);
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

  it('should read and write the Multi-Channel Fulfillment shipping speed (#4185)', () => {
    expect(amazonConnectionConfig.readConfigToForm({ marketplaceIds: [], mcfShippingSpeed: 'Expedited' })).toMatchObject({
      amazonMcfShippingSpeed: 'Expedited',
    });
    expect(amazonConnectionConfig.readConfigToForm({ marketplaceIds: [], mcfShippingSpeed: 'Turbo' })).toMatchObject({
      amazonMcfShippingSpeed: '',
    });
    expect(amazonConnectionConfig.applyToConfig({}, { amazonMcfShippingSpeed: 'Priority' })).toEqual({ mcfShippingSpeed: 'Priority' });
    expect(schema.safeParse({ amazonMcfShippingSpeed: 'Turbo' }).success).toBe(false);
  });
});
