/**
 * KSeF Connection Credentials Shape Validator — unit tests
 *
 * Verifies the `authType` enum check + non-empty `secret`, the
 * `InvalidCredentialsShapeException` rejection path, and that the secret value
 * is never echoed (#1144).
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters/__tests__
 */
import { InvalidCredentialsShapeException } from '@openlinker/core/integrations';
import { KsefConnectionCredentialsShapeValidatorAdapter } from '../ksef-connection-credentials-shape-validator.adapter';

describe('KsefConnectionCredentialsShapeValidatorAdapter', () => {
  const validator = new KsefConnectionCredentialsShapeValidatorAdapter();

  it('should resolve for a ksef-token authType with a non-empty secret', async () => {
    await expect(
      validator.validate({ authType: 'ksef-token', secret: 'super-secret-token' }),
    ).resolves.toBeUndefined();
  });

  it('should resolve for a qualified-seal authType with a non-empty secret', async () => {
    await expect(
      validator.validate({ authType: 'qualified-seal', secret: 'super-secret-seal' }),
    ).resolves.toBeUndefined();
  });

  it('should reject when authType is missing', async () => {
    await expect(validator.validate({ secret: 'super-secret-token' })).rejects.toBeInstanceOf(
      InvalidCredentialsShapeException,
    );
  });

  it('should reject when authType is an unknown value', async () => {
    await expect(
      validator.validate({ authType: 'oauth', secret: 'super-secret-token' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsShapeException);
  });

  it('should reject when authType is not a string', async () => {
    await expect(
      validator.validate({ authType: 7, secret: 'super-secret-token' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsShapeException);
  });

  it('should reject when secret is missing', async () => {
    await expect(validator.validate({ authType: 'ksef-token' })).rejects.toBeInstanceOf(
      InvalidCredentialsShapeException,
    );
  });

  it('should reject when secret is an empty/whitespace string', async () => {
    await expect(
      validator.validate({ authType: 'ksef-token', secret: '   ' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsShapeException);
  });

  it('should carry the plugin name in the rejection', async () => {
    await expect(validator.validate({})).rejects.toMatchObject({ pluginName: 'KSeF' });
  });

  it('should never echo the secret value in the error message', async () => {
    const secret = 'super-secret-value';
    // authType invalid → rejects before secret is even read; assert the
    // secret never leaks regardless.
    await expect(
      validator.validate({ authType: 'oauth', secret }),
    ).rejects.toMatchObject({
      message: expect.not.stringContaining(secret),
    });
  });
});
