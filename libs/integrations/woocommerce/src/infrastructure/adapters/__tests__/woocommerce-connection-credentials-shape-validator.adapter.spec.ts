/**
 * WooCommerce Connection Credentials Shape Validator Adapter — unit tests
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/__tests__
 */
import { InvalidCredentialsShapeException } from '@openlinker/core/integrations';
import { WooCommerceConnectionCredentialsShapeValidatorAdapter } from '../woocommerce-connection-credentials-shape-validator.adapter';

describe('WooCommerceConnectionCredentialsShapeValidatorAdapter', () => {
  const validator = new WooCommerceConnectionCredentialsShapeValidatorAdapter();

  it('should pass when consumerKey and consumerSecret are present', async () => {
    await expect(
      validator.validate({ consumerKey: 'ck_abc', consumerSecret: 'cs_xyz' }),
    ).resolves.toBeUndefined();
  });

  it('should throw InvalidCredentialsShapeException when consumerKey is missing', async () => {
    await expect(
      validator.validate({ consumerSecret: 'cs_xyz' }),
    ).rejects.toThrow(InvalidCredentialsShapeException);
  });

  it('should throw InvalidCredentialsShapeException when consumerSecret is missing', async () => {
    await expect(
      validator.validate({ consumerKey: 'ck_abc' }),
    ).rejects.toThrow(InvalidCredentialsShapeException);
  });

  it('should throw InvalidCredentialsShapeException when consumerKey is empty string', async () => {
    await expect(
      validator.validate({ consumerKey: '', consumerSecret: 'cs_xyz' }),
    ).rejects.toThrow(InvalidCredentialsShapeException);
  });

  it('should throw InvalidCredentialsShapeException when consumerSecret is empty string', async () => {
    await expect(
      validator.validate({ consumerKey: 'ck_abc', consumerSecret: '' }),
    ).rejects.toThrow(InvalidCredentialsShapeException);
  });

  it('should throw InvalidCredentialsShapeException when consumerKey is whitespace only', async () => {
    await expect(
      validator.validate({ consumerKey: '   ', consumerSecret: 'cs_xyz' }),
    ).rejects.toThrow(InvalidCredentialsShapeException);
  });

  it('should throw InvalidCredentialsShapeException when consumerSecret is whitespace only', async () => {
    await expect(
      validator.validate({ consumerKey: 'ck_abc', consumerSecret: '   ' }),
    ).rejects.toThrow(InvalidCredentialsShapeException);
  });

  it('should throw InvalidCredentialsShapeException when both fields are missing', async () => {
    await expect(validator.validate({})).rejects.toThrow(InvalidCredentialsShapeException);
  });

  it('should report both missing fields in a single exception when both are absent', async () => {
    // Both errors are collected in one pass — the operator sees all issues at once.
    await expect(validator.validate({})).rejects.toThrow('consumerKey');
    await expect(validator.validate({})).rejects.toThrow('consumerSecret');
  });
});
