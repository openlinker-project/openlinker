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

  // ADR-077: the country catalogue prices are stated for. Optional - the shop's
  // own PS_COUNTRY_DEFAULT is used when it is absent.
  describe('salesCountryIso2', () => {
    it('should accept a config when salesCountryIso2 is absent', async () => {
      await expect(
        validator.validate({ baseUrl: 'https://shop.example.com' }),
      ).resolves.toBeUndefined();
    });

    it('should accept a config when salesCountryIso2 is a 2-letter uppercase code', async () => {
      await expect(
        validator.validate({ baseUrl: 'https://shop.example.com', salesCountryIso2: 'PL' }),
      ).resolves.toBeUndefined();
    });

    it('should accept a config when salesCountryIso2 is cleared to null', async () => {
      await expect(
        validator.validate({ baseUrl: 'https://shop.example.com', salesCountryIso2: null }),
      ).resolves.toBeUndefined();
    });

    it.each(['pl', 'POL', 'P', 'P1', ' PL', ''])(
      'should reject a config when salesCountryIso2 is %p',
      async (salesCountryIso2) => {
        const error: unknown = await validator
          .validate({ baseUrl: 'https://shop.example.com', salesCountryIso2 })
          .then(
            () => undefined,
            (rejection: unknown) => rejection,
          );

        expect(error).toBeInstanceOf(InvalidConnectionConfigException);
        expect(
          (error as InvalidConnectionConfigException).errors.map((issue) => issue.path),
        ).toContain('salesCountryIso2');
      },
    );

    it('should reject a config when salesCountryIso2 is not a string', async () => {
      await expect(
        validator.validate({ baseUrl: 'https://shop.example.com', salesCountryIso2: 48 }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });
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
