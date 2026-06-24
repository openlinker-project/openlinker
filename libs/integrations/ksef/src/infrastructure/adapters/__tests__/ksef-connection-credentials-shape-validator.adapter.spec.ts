/**
 * KSeF Connection Credentials Shape Validator — unit tests
 *
 * Verifies the `authType` enum check + non-empty opaque `secretRef`, the
 * `InvalidCredentialsShapeException` rejection path, and that the secret value
 * is never echoed (#1144).
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters/__tests__
 */
import { InvalidCredentialsShapeException } from '@openlinker/core/integrations';
import { KsefConnectionCredentialsShapeValidatorAdapter } from '../ksef-connection-credentials-shape-validator.adapter';

describe('KsefConnectionCredentialsShapeValidatorAdapter', () => {
  const validator = new KsefConnectionCredentialsShapeValidatorAdapter();

  it('should resolve for a ksef-token authType with a non-empty secretRef', async () => {
    await expect(
      validator.validate({ authType: 'ksef-token', secretRef: 'vault://ksef/token' }),
    ).resolves.toBeUndefined();
  });

  it('should resolve for a qualified-seal authType with a non-empty secretRef', async () => {
    await expect(
      validator.validate({ authType: 'qualified-seal', secretRef: 'vault://ksef/seal' }),
    ).resolves.toBeUndefined();
  });

  it('should reject when authType is missing', async () => {
    await expect(validator.validate({ secretRef: 'vault://ksef/token' })).rejects.toBeInstanceOf(
      InvalidCredentialsShapeException,
    );
  });

  it('should reject when authType is an unknown value', async () => {
    await expect(
      validator.validate({ authType: 'oauth', secretRef: 'vault://ksef/token' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsShapeException);
  });

  it('should reject when authType is not a string', async () => {
    await expect(
      validator.validate({ authType: 7, secretRef: 'vault://ksef/token' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsShapeException);
  });

  it('should reject when secretRef is missing', async () => {
    await expect(validator.validate({ authType: 'ksef-token' })).rejects.toBeInstanceOf(
      InvalidCredentialsShapeException,
    );
  });

  it('should reject when secretRef is an empty/whitespace string', async () => {
    await expect(
      validator.validate({ authType: 'ksef-token', secretRef: '   ' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsShapeException);
  });

  it('should carry the plugin name in the rejection', async () => {
    await expect(validator.validate({})).rejects.toMatchObject({ pluginName: 'KSeF' });
  });

  it('should never echo the secretRef value in the error message', async () => {
    const secret = 'super-secret-ref-value';
    // authType invalid → rejects before secretRef is even read; assert the
    // secret never leaks regardless.
    await expect(
      validator.validate({ authType: 'oauth', secretRef: secret }),
    ).rejects.toMatchObject({
      message: expect.not.stringContaining(secret),
    });
  });
});
