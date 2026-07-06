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

  describe('bankAccount (#1303 follow-up)', () => {
    const validAccount = { id: '42', accountNumber: '61 1140 2004 0000 0001', bankName: 'mBank' };

    it('should resolve when bankAccount is absent', async () => {
      await expect(validator.validate({})).resolves.toBeUndefined();
    });

    it('should resolve when bankAccount is null', async () => {
      await expect(validator.validate({ bankAccount: null })).resolves.toBeUndefined();
    });

    it('should resolve when bankAccount is well-formed', async () => {
      await expect(validator.validate({ bankAccount: validAccount })).resolves.toBeUndefined();
    });

    it('should resolve when bankAccount id is a legacy number', async () => {
      await expect(
        validator.validate({ bankAccount: { ...validAccount, id: 42 } }),
      ).resolves.toBeUndefined();
    });

    it('should reject when bankAccount is not an object', async () => {
      await expect(validator.validate({ bankAccount: 'nope' })).rejects.toMatchObject({
        pluginName: 'Infakt',
        errors: [{ path: 'bankAccount', message: expect.stringContaining('object') }],
      });
    });

    it('should reject when bankAccount is an array', async () => {
      await expect(validator.validate({ bankAccount: [] })).rejects.toBeInstanceOf(
        InvalidConnectionConfigException,
      );
    });

    it('should reject when bankAccount.id is missing', async () => {
      await expect(
        validator.validate({ bankAccount: { accountNumber: 'x', bankName: 'y' } }),
      ).rejects.toMatchObject({
        errors: [{ path: 'bankAccount.id', message: expect.stringContaining('string or number') }],
      });
    });

    it('should reject when bankAccount.accountNumber is empty', async () => {
      await expect(
        validator.validate({ bankAccount: { ...validAccount, accountNumber: '   ' } }),
      ).rejects.toMatchObject({
        errors: [{ path: 'bankAccount.accountNumber', message: expect.stringContaining('non-empty') }],
      });
    });

    it('should reject when bankAccount.bankName is not a string', async () => {
      await expect(
        validator.validate({ bankAccount: { ...validAccount, bankName: 123 } }),
      ).rejects.toMatchObject({
        errors: [{ path: 'bankAccount.bankName', message: expect.stringContaining('non-empty') }],
      });
    });
  });
});
