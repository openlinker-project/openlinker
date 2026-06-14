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
});
