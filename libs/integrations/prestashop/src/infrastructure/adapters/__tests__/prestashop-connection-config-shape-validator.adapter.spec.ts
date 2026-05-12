/**
 * PrestashopConnectionConfigShapeValidatorAdapter — unit tests
 *
 * Migrated from the pre-#587 `apps/api/.../util/connection-config-validators.spec.ts`
 * (PrestaShop slice).
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { InvalidConnectionConfigException } from '@openlinker/core/integrations';
import { PrestashopConnectionConfigShapeValidatorAdapter } from '../prestashop-connection-config-shape-validator.adapter';

describe('PrestashopConnectionConfigShapeValidatorAdapter', () => {
  const validator = new PrestashopConnectionConfigShapeValidatorAdapter();

  it('accepts a valid config with all required fields', async () => {
    await expect(
      validator.validate({
        baseUrl: 'https://shop.example.com',
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a config missing baseUrl', async () => {
    await expect(validator.validate({})).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('rejects a config with non-URL baseUrl', async () => {
    await expect(
      validator.validate({ baseUrl: 'not-a-url' }),
    ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
  });

  it('exposes PrestaShop as pluginName on the exception', async () => {
    try {
      await validator.validate({});
      fail('expected InvalidConnectionConfigException');
    } catch (error) {
      const exception = error as InvalidConnectionConfigException;
      expect(exception.pluginName).toBe('PrestaShop');
    }
  });
});
