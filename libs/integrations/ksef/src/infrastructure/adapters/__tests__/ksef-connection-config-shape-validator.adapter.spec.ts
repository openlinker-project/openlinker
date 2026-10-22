/**
 * KSeF Connection Config Shape Validator — unit tests
 *
 * Verifies the required `env` enum check (test/demo/prod), the optional
 * The `seller.defaultTaxRate` check was retired with the setting (#2257), and the
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

  describe('seller.defaultTaxRate (retired, #2257)', () => {
    it('should accept a leftover value without validating it, since nothing reads it', async () => {
      // The setting is gone, not the data. Validating a key nothing reads would
      // tell an operator their value is accepted when it is simply ignored; and
      // REJECTING it would fail a connection save over a dead key. Inert is the
      // only honest treatment.
      await expect(
        validator.validate({ env: 'test', seller: { defaultTaxRate: 'not-a-rate' } }),
      ).resolves.toBeUndefined();
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
  describe('seller.nip (#1595)', () => {
    // 1189981779 has a correct mod-11 check digit; 1189981770 mutates it.
    it('should resolve when seller.nip is a checksum-valid NIP', async () => {
      await expect(
        validator.validate({ env: 'test', seller: { nip: '1189981779' } }),
      ).resolves.toBeUndefined();
    });

    it('should resolve when seller.nip is absent', async () => {
      await expect(validator.validate({ env: 'test', seller: {} })).resolves.toBeUndefined();
    });

    it('should reject a valid-format seller.nip with a bad checksum', async () => {
      await expect(validator.validate({ env: 'test', seller: { nip: '1189981770' } })).rejects.toMatchObject({
        errors: [{ path: 'seller.nip', message: 'has an invalid checksum' }],
      });
    });

    it('should reject an invalid-format seller.nip', async () => {
      await expect(validator.validate({ env: 'test', seller: { nip: '12345' } })).rejects.toMatchObject({
        errors: [{ path: 'seller.nip', message: 'must be a 10-digit Polish NIP' }],
      });
    });

    it('should reject a non-string seller.nip', async () => {
      await expect(
        validator.validate({ env: 'test', seller: { nip: 1189981779 } }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should treat an empty seller.nip as not set yet (DEF-19)', async () => {
      await expect(validator.validate({ env: 'test', seller: { nip: '' } })).resolves.toBeUndefined();
    });

    it('should not re-judge a stored NIP the update leaves unchanged (DEF-19)', async () => {
      const stored = { env: 'test', seller: { nip: '1189981770' } };

      await expect(
        validator.validate({ env: 'test', seller: { nip: '1189981770' }, payment: {} }, { previous: stored }),
      ).resolves.toBeUndefined();
    });

    it('should still check a NIP the update changes, even with a previous config', async () => {
      await expect(
        validator.validate(
          { env: 'test', seller: { nip: '1189981770' } },
          { previous: { env: 'test', seller: { nip: '1189981779' } } },
        ),
      ).rejects.toMatchObject({ errors: [{ path: 'seller.nip', message: 'has an invalid checksum' }] });
    });

    it('should compare the stored NIP without separators', async () => {
      await expect(
        validator.validate(
          { env: 'test', seller: { nip: '118-998-17-70' } },
          { previous: { env: 'test', seller: { nip: '1189981770' } } },
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('allowCrossBorder (DEF-18)', () => {
    it('should accept a boolean', async () => {
      await expect(validator.validate({ env: 'test', allowCrossBorder: true })).resolves.toBeUndefined();
      await expect(validator.validate({ env: 'test', allowCrossBorder: false })).resolves.toBeUndefined();
    });

    it('should reject a string, which the issuance path would silently ignore', async () => {
      await expect(validator.validate({ env: 'test', allowCrossBorder: 'true' })).rejects.toMatchObject({
        errors: [{ path: 'allowCrossBorder', message: 'must be true or false' }],
      });
    });
  });

});
