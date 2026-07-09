/**
 * Erli Connection Config Shape Validator — unit tests
 *
 * Verifies the permissive config check (empty config valid; optional `baseUrl`
 * must be a non-empty https URL when present) and the flat-issue rejection
 * payload (#982).
 *
 * @module libs/integrations/erli/src/infrastructure/adapters/__tests__
 */
import { InvalidConnectionConfigException } from '@openlinker/core/integrations';
import { ErliConnectionConfigShapeValidatorAdapter } from '../erli-connection-config-shape-validator.adapter';

describe('ErliConnectionConfigShapeValidatorAdapter', () => {
  const validator = new ErliConnectionConfigShapeValidatorAdapter();

  it('should resolve for an empty config (no required fields)', async () => {
    await expect(validator.validate({})).resolves.toBeUndefined();
  });

  it('should resolve when baseUrl is a valid https URL', async () => {
    await expect(
      validator.validate({ baseUrl: 'https://sandbox.erli.dev/svc/shop-api' }),
    ).resolves.toBeUndefined();
  });

  it('should reject when baseUrl is a non-https URL', async () => {
    await expect(validator.validate({ baseUrl: 'http://erli.pl/svc' })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should resolve when baseUrl is the apex prod host', async () => {
    await expect(validator.validate({ baseUrl: 'https://erli.pl/svc/shop-api' })).resolves.toBeUndefined();
  });

  it('should reject an https URL whose host is not Erli-owned (SSRF guard)', async () => {
    await expect(validator.validate({ baseUrl: 'https://evil.example.com/svc' })).rejects.toMatchObject({
      errors: [{ path: 'baseUrl', message: expect.stringContaining('host must be') }],
    });
  });

  it('should reject a look-alike host that merely ends with the apex string', async () => {
    // `noterli.pl` is NOT a subdomain of `erli.pl` — the leading-dot suffix
    // check must reject it rather than match on a bare endsWith.
    await expect(validator.validate({ baseUrl: 'https://noterli.pl/svc' })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should reject when baseUrl is not a valid URL', async () => {
    await expect(validator.validate({ baseUrl: 'not-a-url' })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should reject when baseUrl is an empty string', async () => {
    await expect(validator.validate({ baseUrl: '' })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should carry a flat { path, message } issue for baseUrl', async () => {
    await expect(validator.validate({ baseUrl: 'not-a-url' })).rejects.toMatchObject({
      pluginName: 'Erli',
      errors: [{ path: 'baseUrl', message: expect.any(String) }],
    });
  });

  it('should resolve for a valid defaultDispatchTime', async () => {
    await expect(
      validator.validate({ defaultDispatchTime: { period: 2, unit: 'day' } }),
    ).resolves.toBeUndefined();
  });

  it('should resolve for a defaultDispatchTime without a unit (unit defaults server-side)', async () => {
    await expect(
      validator.validate({ defaultDispatchTime: { period: 0 } }),
    ).resolves.toBeUndefined();
  });

  it('should reject a defaultDispatchTime with a non-integer / negative period', async () => {
    await expect(
      validator.validate({ defaultDispatchTime: { period: -1 } }),
    ).rejects.toMatchObject({
      errors: [{ path: 'defaultDispatchTime.period', message: expect.any(String) }],
    });
  });

  it('should reject a defaultDispatchTime with an unknown unit', async () => {
    await expect(
      validator.validate({ defaultDispatchTime: { period: 1, unit: 'week' } }),
    ).rejects.toMatchObject({
      errors: [{ path: 'defaultDispatchTime.unit', message: expect.any(String) }],
    });
  });

  it('should resolve for a callbackBaseUrl that is a valid http(s) URL (#996)', async () => {
    await expect(
      validator.validate({ callbackBaseUrl: 'http://host.docker.internal:3000' }),
    ).resolves.toBeUndefined();
    await expect(
      validator.validate({ callbackBaseUrl: 'https://ol.example.com' }),
    ).resolves.toBeUndefined();
  });

  it('should reject a callbackBaseUrl that is not a valid URL (#996)', async () => {
    await expect(validator.validate({ callbackBaseUrl: 'not-a-url' })).rejects.toMatchObject({
      errors: [{ path: 'callbackBaseUrl', message: expect.any(String) }],
    });
  });

  describe('environment (#1377)', () => {
    it('should resolve when environment is absent', async () => {
      await expect(validator.validate({})).resolves.toBeUndefined();
    });

    it('should resolve when environment is "sandbox"', async () => {
      await expect(validator.validate({ environment: 'sandbox' })).resolves.toBeUndefined();
    });

    it('should resolve when environment is "production"', async () => {
      await expect(validator.validate({ environment: 'production' })).resolves.toBeUndefined();
    });

    it('should reject an unknown environment value', async () => {
      await expect(validator.validate({ environment: 'staging' })).rejects.toMatchObject({
        errors: [{ path: 'environment', message: expect.any(String) }],
      });
    });

    it('should reject a non-string environment value', async () => {
      await expect(validator.validate({ environment: 123 })).rejects.toMatchObject({
        errors: [{ path: 'environment', message: expect.any(String) }],
      });
    });
  });

  describe('allegroEnvironment (#1382/#1383, ADR-031)', () => {
    it('should resolve when allegroEnvironment is absent', async () => {
      await expect(validator.validate({})).resolves.toBeUndefined();
    });

    it('should resolve when allegroEnvironment is "sandbox"', async () => {
      await expect(validator.validate({ allegroEnvironment: 'sandbox' })).resolves.toBeUndefined();
    });

    it('should resolve when allegroEnvironment is "production"', async () => {
      await expect(validator.validate({ allegroEnvironment: 'production' })).resolves.toBeUndefined();
    });

    it('should reject an unknown allegroEnvironment value', async () => {
      await expect(validator.validate({ allegroEnvironment: 'staging' })).rejects.toMatchObject({
        errors: [{ path: 'allegroEnvironment', message: expect.any(String) }],
      });
    });

    it('should reject a non-string allegroEnvironment value', async () => {
      await expect(validator.validate({ allegroEnvironment: 123 })).rejects.toMatchObject({
        errors: [{ path: 'allegroEnvironment', message: expect.any(String) }],
      });
    });
  });

  describe('allegroCategoryAccessEnabled (#1383, ADR-031 "Correction")', () => {
    it('should resolve when allegroCategoryAccessEnabled is absent', async () => {
      await expect(validator.validate({})).resolves.toBeUndefined();
    });

    it('should resolve when allegroCategoryAccessEnabled is true', async () => {
      await expect(
        validator.validate({ allegroCategoryAccessEnabled: true })
      ).resolves.toBeUndefined();
    });

    it('should resolve when allegroCategoryAccessEnabled is false', async () => {
      await expect(
        validator.validate({ allegroCategoryAccessEnabled: false })
      ).resolves.toBeUndefined();
    });

    it('should reject a non-boolean allegroCategoryAccessEnabled value', async () => {
      await expect(
        validator.validate({ allegroCategoryAccessEnabled: 'true' })
      ).rejects.toMatchObject({
        errors: [{ path: 'allegroCategoryAccessEnabled', message: expect.any(String) }],
      });
    });
  });
});
