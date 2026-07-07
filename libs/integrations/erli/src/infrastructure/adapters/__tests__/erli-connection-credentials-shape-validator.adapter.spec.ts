/**
 * Erli Connection Credentials Shape Validator — unit tests
 *
 * Verifies the single-field `apiKey` shape check and the
 * `InvalidCredentialsShapeException` rejection path (#982).
 *
 * @module libs/integrations/erli/src/infrastructure/adapters/__tests__
 */
import { InvalidCredentialsShapeException } from '@openlinker/core/integrations';
import { ErliConnectionCredentialsShapeValidatorAdapter } from '../erli-connection-credentials-shape-validator.adapter';

describe('ErliConnectionCredentialsShapeValidatorAdapter', () => {
  const validator = new ErliConnectionCredentialsShapeValidatorAdapter();

  it('should resolve when a non-empty apiKey string is present', async () => {
    await expect(validator.validate({ apiKey: 'secret-key' })).resolves.toBeUndefined();
  });

  it('should reject when apiKey is missing', async () => {
    await expect(validator.validate({})).rejects.toBeInstanceOf(InvalidCredentialsShapeException);
  });

  it('should reject when apiKey is an empty/whitespace string', async () => {
    await expect(validator.validate({ apiKey: '   ' })).rejects.toBeInstanceOf(
      InvalidCredentialsShapeException,
    );
  });

  it('should reject when apiKey is not a string', async () => {
    await expect(validator.validate({ apiKey: 123 })).rejects.toBeInstanceOf(
      InvalidCredentialsShapeException,
    );
  });

  it('should carry the plugin name in the rejection', async () => {
    await expect(validator.validate({})).rejects.toMatchObject({ pluginName: 'Erli' });
  });

  describe('allegroClientId/allegroClientSecret pair (#1382/#1383, ADR-031)', () => {
    it('should resolve when neither Allegro credential is present', async () => {
      await expect(validator.validate({ apiKey: 'secret-key' })).resolves.toBeUndefined();
    });

    it('should resolve when both Allegro credentials are present as non-empty strings', async () => {
      await expect(
        validator.validate({
          apiKey: 'secret-key',
          allegroClientId: 'client-1',
          allegroClientSecret: 'secret-1',
        }),
      ).resolves.toBeUndefined();
    });

    it('should reject when only allegroClientId is present', async () => {
      await expect(
        validator.validate({ apiKey: 'secret-key', allegroClientId: 'client-1' }),
      ).rejects.toBeInstanceOf(InvalidCredentialsShapeException);
    });

    it('should reject when only allegroClientSecret is present', async () => {
      await expect(
        validator.validate({ apiKey: 'secret-key', allegroClientSecret: 'secret-1' }),
      ).rejects.toBeInstanceOf(InvalidCredentialsShapeException);
    });

    it('should reject when both are present but one is an empty string', async () => {
      await expect(
        validator.validate({
          apiKey: 'secret-key',
          allegroClientId: '  ',
          allegroClientSecret: 'secret-1',
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsShapeException);
    });

    it('should reject when both are present but one is not a string', async () => {
      await expect(
        validator.validate({
          apiKey: 'secret-key',
          allegroClientId: 123,
          allegroClientSecret: 'secret-1',
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsShapeException);
    });
  });
});
