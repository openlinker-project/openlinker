/**
 * PrestashopConnectionCredentialsShapeValidatorAdapter — unit tests
 *
 * Migrated from the pre-#586 `apps/api/.../credentials/credential-shape.validator.spec.ts`.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { InvalidCredentialsShapeException } from '@openlinker/core/integrations';
import { PrestashopConnectionCredentialsShapeValidatorAdapter } from '../prestashop-connection-credentials-shape-validator.adapter';

describe('PrestashopConnectionCredentialsShapeValidatorAdapter', () => {
  const validator = new PrestashopConnectionCredentialsShapeValidatorAdapter();

  it('accepts a non-empty webserviceApiKey', async () => {
    await expect(
      validator.validate({ webserviceApiKey: 'ABC123' }),
    ).resolves.toBeUndefined();
  });

  it('rejects a missing webserviceApiKey', async () => {
    await expect(validator.validate({})).rejects.toBeInstanceOf(
      InvalidCredentialsShapeException,
    );
  });

  it('rejects an empty webserviceApiKey', async () => {
    await expect(
      validator.validate({ webserviceApiKey: '' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsShapeException);
  });

  it('rejects a whitespace-only webserviceApiKey', async () => {
    await expect(
      validator.validate({ webserviceApiKey: '   ' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsShapeException);
  });

  it('rejects a non-string webserviceApiKey', async () => {
    await expect(
      validator.validate({ webserviceApiKey: 12345 }),
    ).rejects.toBeInstanceOf(InvalidCredentialsShapeException);
  });

  it('exposes PrestaShop as pluginName on the exception', async () => {
    try {
      await validator.validate({});
      fail('expected InvalidCredentialsShapeException');
    } catch (error) {
      const exception = error as InvalidCredentialsShapeException;
      expect(exception.pluginName).toBe('PrestaShop');
      expect(exception.message).toContain('webserviceApiKey');
    }
  });
});
