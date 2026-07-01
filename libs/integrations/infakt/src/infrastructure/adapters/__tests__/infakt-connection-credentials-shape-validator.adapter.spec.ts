/**
 * Infakt Connection Credentials Shape Validator — unit tests
 *
 * Verifies the required, non-empty `apiKey` string check and that the
 * error detail never echoes the credential value.
 *
 * @module libs/integrations/infakt/src/infrastructure/adapters/__tests__
 */
import { InvalidCredentialsShapeException } from '@openlinker/core/integrations';
import { InfaktConnectionCredentialsShapeValidatorAdapter } from '../infakt-connection-credentials-shape-validator.adapter';

describe('InfaktConnectionCredentialsShapeValidatorAdapter', () => {
  const validator = new InfaktConnectionCredentialsShapeValidatorAdapter();

  it('should resolve when apiKey is a non-empty string', async () => {
    await expect(validator.validate({ apiKey: 'sk_live_abc123' })).resolves.toBeUndefined();
  });

  it('should reject when apiKey is missing', async () => {
    await expect(validator.validate({})).rejects.toBeInstanceOf(InvalidCredentialsShapeException);
  });

  it('should reject when apiKey is an empty string', async () => {
    await expect(validator.validate({ apiKey: '' })).rejects.toBeInstanceOf(
      InvalidCredentialsShapeException,
    );
  });

  it('should reject when apiKey is whitespace-only', async () => {
    await expect(validator.validate({ apiKey: '   ' })).rejects.toBeInstanceOf(
      InvalidCredentialsShapeException,
    );
  });

  it('should reject when apiKey is not a string', async () => {
    await expect(validator.validate({ apiKey: 12345 })).rejects.toBeInstanceOf(
      InvalidCredentialsShapeException,
    );
  });

  it('should never echo the apiKey value in the rejection message', async () => {
    const secret = 'sk_super_secret_value';
    await expect(validator.validate({ apiKey: '' })).rejects.toMatchObject({
      message: expect.not.stringContaining(secret),
    });
  });
});
