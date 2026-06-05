/**
 * WooCommerce Connection Config Shape Validator Adapter — unit tests
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/__tests__
 */
import { InvalidConnectionConfigException } from '@openlinker/core/integrations';
import { WooCommerceConnectionConfigShapeValidatorAdapter } from '../woocommerce-connection-config-shape-validator.adapter';

describe('WooCommerceConnectionConfigShapeValidatorAdapter', () => {
  const validator = new WooCommerceConnectionConfigShapeValidatorAdapter();

  it('should pass when siteUrl is a valid https URL', async () => {
    await expect(
      validator.validate({ siteUrl: 'https://myshop.com' }),
    ).resolves.toBeUndefined();
  });

  it('should throw InvalidConnectionConfigException when siteUrl uses http instead of https', async () => {
    await expect(
      validator.validate({ siteUrl: 'http://myshop.com' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should pass when siteUrl is a localhost URL with https', async () => {
    await expect(
      validator.validate({ siteUrl: 'https://localhost:8080' }),
    ).resolves.toBeUndefined();
  });

  it('should throw InvalidConnectionConfigException when siteUrl is missing', async () => {
    await expect(validator.validate({})).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should throw InvalidConnectionConfigException when siteUrl is not a URL', async () => {
    await expect(
      validator.validate({ siteUrl: 'not-a-url' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should throw InvalidConnectionConfigException when siteUrl has no protocol', async () => {
    await expect(
      validator.validate({ siteUrl: 'myshop.com' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should throw InvalidConnectionConfigException when siteUrl is an empty string', async () => {
    await expect(
      validator.validate({ siteUrl: '' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should pass when config carries extra keys alongside siteUrl', async () => {
    // whitelist: false — adjacent keys from future releases must not break validation
    await expect(
      validator.validate({ siteUrl: 'https://myshop.com', futureField: 'value' }),
    ).resolves.toBeUndefined();
  });
});
