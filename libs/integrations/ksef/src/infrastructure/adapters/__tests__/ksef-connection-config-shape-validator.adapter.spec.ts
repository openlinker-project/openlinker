/**
 * KSeF Connection Config Shape Validator — unit tests
 *
 * Verifies the required `env` enum check (test/demo/prod), the optional
 * `seller.defaultTaxRate` check against `FA3_TAX_RATE_MAP` (#1291), and the
 * flat-issue rejection payload, with neutral error messaging (#1144).
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters/__tests__
 */
import { InvalidConnectionConfigException } from '@openlinker/core/integrations';
import { KsefConnectionConfigShapeValidatorAdapter } from '../ksef-connection-config-shape-validator.adapter';

describe('KsefConnectionConfigShapeValidatorAdapter', () => {
  const validator = new KsefConnectionConfigShapeValidatorAdapter();

  it('should resolve when env is "test"', async () => {
    await expect(validator.validate({ env: 'test' })).resolves.toBeUndefined();
  });

  it('should resolve when env is "demo"', async () => {
    await expect(validator.validate({ env: 'demo' })).resolves.toBeUndefined();
  });

  it('should resolve when env is "prod"', async () => {
    await expect(validator.validate({ env: 'prod' })).resolves.toBeUndefined();
  });

  it('should reject when env is missing', async () => {
    await expect(validator.validate({})).rejects.toBeInstanceOf(InvalidConnectionConfigException);
  });

  it('should reject when env is not a known value', async () => {
    await expect(validator.validate({ env: 'staging' })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should reject when env is an empty string', async () => {
    await expect(validator.validate({ env: '' })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should reject when env is whitespace-only', async () => {
    await expect(validator.validate({ env: '   ' })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should reject when env is not a string', async () => {
    await expect(validator.validate({ env: 1 })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should carry a flat { path, message } issue for env', async () => {
    await expect(validator.validate({ env: 'staging' })).rejects.toMatchObject({
      pluginName: 'KSeF',
      errors: [{ path: 'env', message: expect.stringContaining('must be one of') }],
    });
  });

  describe('seller.defaultTaxRate', () => {
    it('should resolve when seller.defaultTaxRate is a known FA3_TAX_RATE_MAP key', async () => {
      await expect(
        validator.validate({ env: 'test', seller: { defaultTaxRate: '23' } }),
      ).resolves.toBeUndefined();
    });

    it('should resolve when seller.defaultTaxRate is absent', async () => {
      await expect(
        validator.validate({ env: 'test', seller: { nip: '1234567890' } }),
      ).resolves.toBeUndefined();
    });

    it('should resolve when seller is absent entirely', async () => {
      await expect(validator.validate({ env: 'test' })).resolves.toBeUndefined();
    });

    it('should reject when seller.defaultTaxRate is not a known FA3_TAX_RATE_MAP key', async () => {
      await expect(
        validator.validate({ env: 'test', seller: { defaultTaxRate: '23%' } }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should reject when seller.defaultTaxRate is an empty string', async () => {
      await expect(
        validator.validate({ env: 'test', seller: { defaultTaxRate: '' } }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should reject when seller.defaultTaxRate is whitespace-only', async () => {
      await expect(
        validator.validate({ env: 'test', seller: { defaultTaxRate: '   ' } }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should reject when seller.defaultTaxRate is not a string', async () => {
      await expect(
        validator.validate({ env: 'test', seller: { defaultTaxRate: 23 } }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
      'should reject the inherited-prototype key %s (not a real FA3_TAX_RATE_MAP entry)',
      async (protoKey) => {
        await expect(
          validator.validate({ env: 'test', seller: { defaultTaxRate: protoKey } }),
        ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
      },
    );

    it('should carry a flat { path, message } issue for seller.defaultTaxRate', async () => {
      await expect(
        validator.validate({ env: 'test', seller: { defaultTaxRate: '23%' } }),
      ).rejects.toMatchObject({
        pluginName: 'KSeF',
        errors: [
          { path: 'seller.defaultTaxRate', message: expect.stringContaining('must be one of') },
        ],
      });
    });
  });

  describe('payment (#1311)', () => {
    it('should resolve when payment is absent', async () => {
      await expect(validator.validate({ env: 'test' })).resolves.toBeUndefined();
    });

    it('should resolve for a fully-configured payment', async () => {
      await expect(
        validator.validate({
          env: 'test',
          payment: {
            formaPlatnosci: '6',
            bankAccount: { nrRb: '61109010140000000099999999' },
            paymentTermDays: 14,
          },
        }),
      ).resolves.toBeUndefined();
    });

    it('should reject a non-object payment', async () => {
      await expect(validator.validate({ env: 'test', payment: 'foo' })).rejects.toMatchObject({
        pluginName: 'KSeF',
        errors: [{ path: 'payment', message: 'must be an object' }],
      });
    });

    it('should reject a null payment', async () => {
      await expect(validator.validate({ env: 'test', payment: null })).rejects.toMatchObject({
        pluginName: 'KSeF',
        errors: [{ path: 'payment', message: 'must be an object' }],
      });
    });

    it('should reject a non-object bankAccount', async () => {
      await expect(
        validator.validate({ env: 'test', payment: { bankAccount: 'foo' } }),
      ).rejects.toMatchObject({
        pluginName: 'KSeF',
        errors: [{ path: 'payment.bankAccount', message: 'must be an object' }],
      });
    });

    it('should reject a non-object skonto', async () => {
      await expect(
        validator.validate({ env: 'test', payment: { skonto: 'foo' } }),
      ).rejects.toMatchObject({
        pluginName: 'KSeF',
        errors: [{ path: 'payment.skonto', message: 'must be an object' }],
      });
    });

    it('should reject an unknown formaPlatnosci value', async () => {
      await expect(
        validator.validate({ env: 'test', payment: { formaPlatnosci: '9' } }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should reject a non-string formaPlatnosci', async () => {
      await expect(
        validator.validate({ env: 'test', payment: { formaPlatnosci: 6 } }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should reject an empty bankAccount.nrRb', async () => {
      await expect(
        validator.validate({ env: 'test', payment: { bankAccount: { nrRb: '' } } }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should reject a whitespace-only bankAccount.nrRb', async () => {
      await expect(
        validator.validate({ env: 'test', payment: { bankAccount: { nrRb: '   ' } } }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should reject a bankAccount.nrRb containing inner whitespace', async () => {
      await expect(
        validator.validate({
          env: 'test',
          payment: { bankAccount: { nrRb: '61 1090 1014 0000 0000 0999 9999' } },
        }),
      ).rejects.toMatchObject({
        pluginName: 'KSeF',
        errors: [
          {
            path: 'payment.bankAccount.nrRb',
            message: expect.stringContaining('must not contain whitespace'),
          },
        ],
      });
    });

    it('should reject a bankAccount.nrRb shorter than 10 characters', async () => {
      await expect(
        validator.validate({ env: 'test', payment: { bankAccount: { nrRb: '123' } } }),
      ).rejects.toMatchObject({
        pluginName: 'KSeF',
        errors: [
          { path: 'payment.bankAccount.nrRb', message: expect.stringContaining('10-34') },
        ],
      });
    });

    it('should reject a bankAccount.nrRb longer than 34 characters', async () => {
      await expect(
        validator.validate({
          env: 'test',
          payment: { bankAccount: { nrRb: '1'.repeat(35) } },
        }),
      ).rejects.toMatchObject({
        pluginName: 'KSeF',
        errors: [
          { path: 'payment.bankAccount.nrRb', message: expect.stringContaining('10-34') },
        ],
      });
    });

    it('should accept a bankAccount.nrRb at the 10-character lower bound', async () => {
      await expect(
        validator.validate({ env: 'test', payment: { bankAccount: { nrRb: '1234567890' } } }),
      ).resolves.toBeUndefined();
    });

    it('should reject a negative paymentTermDays', async () => {
      await expect(
        validator.validate({ env: 'test', payment: { paymentTermDays: -1 } }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should reject a non-integer paymentTermDays', async () => {
      await expect(
        validator.validate({ env: 'test', payment: { paymentTermDays: 14.5 } }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should accept paymentTermDays of 0', async () => {
      await expect(
        validator.validate({ env: 'test', payment: { paymentTermDays: 0 } }),
      ).resolves.toBeUndefined();
    });

    it('should accept paymentTermDays at the 999 upper bound', async () => {
      await expect(
        validator.validate({ env: 'test', payment: { paymentTermDays: 999 } }),
      ).resolves.toBeUndefined();
    });

    it('should reject a paymentTermDays above the 999 sanity cap', async () => {
      await expect(
        validator.validate({ env: 'test', payment: { paymentTermDays: 1400 } }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should carry a flat { path, message } issue for payment.formaPlatnosci', async () => {
      await expect(
        validator.validate({ env: 'test', payment: { formaPlatnosci: '9' } }),
      ).rejects.toMatchObject({
        pluginName: 'KSeF',
        errors: [{ path: 'payment.formaPlatnosci', message: expect.stringContaining('must be one of') }],
      });
    });

    it('should resolve for a fully-configured skonto', async () => {
      await expect(
        validator.validate({
          env: 'test',
          payment: { skonto: { conditions: '2% if paid within 7 days', amount: '2%' } },
        }),
      ).resolves.toBeUndefined();
    });

    it('should reject skonto with conditions but no amount', async () => {
      await expect(
        validator.validate({ env: 'test', payment: { skonto: { conditions: 'text' } } }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should reject skonto with amount but no conditions', async () => {
      await expect(
        validator.validate({ env: 'test', payment: { skonto: { amount: '2%' } } }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should reject an empty skonto object', async () => {
      await expect(
        validator.validate({ env: 'test', payment: { skonto: {} } }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });
  });

  describe('invoiceDefaults.lineUnit (#1525)', () => {
    it('should resolve when invoiceDefaults is absent', async () => {
      await expect(validator.validate({ env: 'test' })).resolves.toBeUndefined();
    });

    it('should resolve for a valid lineUnit', async () => {
      await expect(
        validator.validate({ env: 'test', invoiceDefaults: { lineUnit: 'szt.' } }),
      ).resolves.toBeUndefined();
    });

    it('should resolve for an empty lineUnit (treated as absent, not an error)', async () => {
      await expect(
        validator.validate({ env: 'test', invoiceDefaults: { lineUnit: '' } }),
      ).resolves.toBeUndefined();
    });

    it('should resolve for a whitespace-only lineUnit (treated as absent)', async () => {
      await expect(
        validator.validate({ env: 'test', invoiceDefaults: { lineUnit: '   ' } }),
      ).resolves.toBeUndefined();
    });

    it('should resolve for a lineUnit of exactly 20 characters after trim', async () => {
      await expect(
        validator.validate({ env: 'test', invoiceDefaults: { lineUnit: ` ${'x'.repeat(20)} ` } }),
      ).resolves.toBeUndefined();
    });

    it('should reject a lineUnit longer than 20 characters after trim', async () => {
      await expect(
        validator.validate({ env: 'test', invoiceDefaults: { lineUnit: 'x'.repeat(21) } }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should reject a non-string lineUnit', async () => {
      await expect(
        validator.validate({ env: 'test', invoiceDefaults: { lineUnit: 5 } }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should reject a non-object invoiceDefaults', async () => {
      await expect(
        validator.validate({ env: 'test', invoiceDefaults: 'szt.' }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should carry a flat { path, message } issue for invoiceDefaults.lineUnit', async () => {
      expect.assertions(1);
      try {
        await validator.validate({ env: 'test', invoiceDefaults: { lineUnit: 'x'.repeat(21) } });
      } catch (error) {
        expect((error as InvalidConnectionConfigException).errors).toEqual([
          {
            path: 'invoiceDefaults.lineUnit',
            message: 'must be at most 20 characters after trimming',
          },
        ]);
      }
    });
  });
});
