/**
 * Infakt Connection Config Shape Validator — unit tests
 *
 * Verifies the optional `baseUrl` URL check, the optional
 * `defaultPaymentMethod` enum check (#1303), and the flat-issue rejection
 * payload.
 *
 * @module libs/integrations/infakt/src/infrastructure/adapters/__tests__
 */
import { InvalidConnectionConfigException } from '@openlinker/core/integrations';
import { InfaktConnectionConfigShapeValidatorAdapter } from '../infakt-connection-config-shape-validator.adapter';

describe('InfaktConnectionConfigShapeValidatorAdapter', () => {
  const validator = new InfaktConnectionConfigShapeValidatorAdapter();

  it('should resolve when config is empty (baseUrl is optional)', async () => {
    await expect(validator.validate({})).resolves.toBeUndefined();
  });

  it('should resolve when baseUrl is a valid URL', async () => {
    await expect(
      validator.validate({ baseUrl: 'https://api.sandbox.infakt.pl/api/v3' }),
    ).resolves.toBeUndefined();
  });

  it('should resolve when baseUrl is null', async () => {
    await expect(validator.validate({ baseUrl: null })).resolves.toBeUndefined();
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

  it('should reject when baseUrl is whitespace-only', async () => {
    await expect(validator.validate({ baseUrl: '   ' })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should reject when baseUrl is not a string', async () => {
    await expect(validator.validate({ baseUrl: 123 })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should carry a flat { path, message } issue for baseUrl', async () => {
    await expect(validator.validate({ baseUrl: 'not-a-url' })).rejects.toMatchObject({
      pluginName: 'Infakt',
      errors: [{ path: 'baseUrl', message: expect.stringContaining('valid URL') }],
    });
  });

  it('should resolve when defaultPaymentMethod is absent', async () => {
    await expect(validator.validate({})).resolves.toBeUndefined();
  });

  it.each(['cash', 'transfer'])(
    'should resolve when defaultPaymentMethod is %s',
    async (defaultPaymentMethod) => {
      await expect(validator.validate({ defaultPaymentMethod })).resolves.toBeUndefined();
    },
  );

  it('should resolve when defaultPaymentMethod is null', async () => {
    await expect(validator.validate({ defaultPaymentMethod: null })).resolves.toBeUndefined();
  });

  it('should reject when defaultPaymentMethod is not a supported value', async () => {
    await expect(
      validator.validate({ defaultPaymentMethod: 'card' }),
    ).rejects.toMatchObject({
      pluginName: 'Infakt',
      errors: [
        { path: 'defaultPaymentMethod', message: expect.stringContaining('cash, transfer') },
      ],
    });
  });

  it('should reject when defaultPaymentMethod is not a string', async () => {
    await expect(validator.validate({ defaultPaymentMethod: 123 })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });
});
