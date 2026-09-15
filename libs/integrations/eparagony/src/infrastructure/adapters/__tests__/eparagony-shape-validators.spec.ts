import {
  InvalidConnectionConfigException,
  InvalidCredentialsShapeException,
} from '@openlinker/core/integrations';

import { EparagonyConnectionConfigShapeValidatorAdapter } from '../eparagony-connection-config-shape-validator.adapter';
import { EparagonyConnectionCredentialsShapeValidatorAdapter } from '../eparagony-connection-credentials-shape-validator.adapter';

describe('EparagonyConnectionConfigShapeValidatorAdapter', () => {
  const validator = new EparagonyConnectionConfigShapeValidatorAdapter();

  it('should accept a minimal valid config', async () => {
    await expect(
      validator.validate({ environment: 'sandbox', posId: 'pos-10' }),
    ).resolves.toBeUndefined();
  });

  it('should reject a config with no environment', async () => {
    await expect(validator.validate({ posId: 'pos-10' })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should reject a config with no point-of-sale identifier', async () => {
    await expect(validator.validate({ environment: 'production' })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should reject an unknown rate slot', async () => {
    await expect(
      validator.validate({ environment: 'sandbox', posId: 'p', taxRates: { H: '23' } }),
    ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
  });

  it('should accept a partial rate table when only some slots are overridden', async () => {
    await expect(
      validator.validate({ environment: 'sandbox', posId: 'p', taxRates: { B: '7' } }),
    ).resolves.toBeUndefined();
  });

  it('should reject a default rate code outside the device slots', async () => {
    await expect(
      validator.validate({ environment: 'sandbox', posId: 'p', defaultTaxRateCode: 'Z' }),
    ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
  });

  it('should reject a non-https host override', async () => {
    await expect(
      validator.validate({ environment: 'sandbox', posId: 'p', apiBaseUrl: 'http://x.test' }),
    ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
  });

  it('should reject a payment form the fiscal device does not know', async () => {
    await expect(
      validator.validate({ environment: 'sandbox', posId: 'p', paymentForm: 'Bitcoin' }),
    ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
  });

  // The invoice lane's four keys (#3192).
  describe('invoice lane configuration', () => {
    const base = { environment: 'sandbox', posId: 'p' };
    const address = {
      street: 'Testowa',
      number: '1',
      postalCode: '00-001',
      city: 'Warszawa',
      country: 'PL',
    };

    it('should accept a receipts-only config that carries none of the invoice keys', async () => {
      // THE REGRESSION THIS GUARDS. Every connection shipped before #3192 is
      // receipts-only, and `ConnectionService` re-validates the whole config on
      // every save - so a key promoted to required would refuse an existing
      // connection's own stored config the next time an operator touched an
      // unrelated field on it.
      await expect(validator.validate({ ...base })).resolves.toBeUndefined();
    });

    it('should accept a fully configured invoice lane', async () => {
      await expect(
        validator.validate({
          ...base,
          merchantTIN: '5213796333',
          merchantName: 'Sprzedawca Sp. z o.o.',
          merchantAddress: address,
          eInvoicingHubEnabled: true,
        }),
      ).resolves.toBeUndefined();
    });

    it('should treat an explicit null as absent, the way an operator-authored blob carries one', async () => {
      await expect(
        validator.validate({
          ...base,
          merchantTIN: null,
          merchantName: null,
          merchantAddress: null,
          eInvoicingHubEnabled: null,
        }),
      ).resolves.toBeUndefined();
    });

    it('should reject a blank seller tax number rather than silently ignoring it', async () => {
      // The mapper reads it through `readNonEmpty`, so a blank one is treated as
      // absent and refuses the invoice pre-call. Catching it at save time turns
      // configured-but-ignored into something the operator can see.
      await expect(
        validator.validate({ ...base, merchantTIN: '   ' }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should reject a blank seller name', async () => {
      await expect(validator.validate({ ...base, merchantName: '' })).rejects.toBeInstanceOf(
        InvalidConnectionConfigException,
      );
    });

    it('should reject a seller address that is not an object', async () => {
      await expect(
        validator.validate({ ...base, merchantAddress: 'Testowa 1, Warszawa' }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should reject a partial seller address, naming the missing part', async () => {
      // `toSellerEntityAddress` copies the operator's object across field by
      // field with no interpretation, so this validator is the only gate - and
      // the vendor rejects the whole document over a missing part.
      const withoutPostalCode = {
        street: address.street,
        number: address.number,
        city: address.city,
        country: address.country,
      };

      await expect(
        validator.validate({ ...base, merchantAddress: withoutPostalCode }),
      ).rejects.toMatchObject({
        errors: expect.arrayContaining([
          expect.objectContaining({ path: 'merchantAddress.postalCode' }),
        ]),
      });
    });

    it('should reject a country spelled out in full rather than as its two-letter code', async () => {
      await expect(
        validator.validate({ ...base, merchantAddress: { ...address, country: 'Poland' } }),
      ).rejects.toMatchObject({
        errors: expect.arrayContaining([
          expect.objectContaining({ path: 'merchantAddress.country' }),
        ]),
      });
    });

    it('should accept an apartment, the one optional part of the address', async () => {
      await expect(
        validator.validate({ ...base, merchantAddress: { ...address, apartment: '4B' } }),
      ).resolves.toBeUndefined();
    });

    it('should reject a non-boolean hub flag', async () => {
      // A truthy string would read as "relay to the hub" to a caller testing
      // truthiness, while the mapper's `=== true` leaves it off - the two
      // readings disagree about whether an invoice reaches the authority.
      await expect(
        validator.validate({ ...base, eInvoicingHubEnabled: 'yes' }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    });

    it('should accept the hub flag switched off explicitly', async () => {
      await expect(
        validator.validate({ ...base, eInvoicingHubEnabled: false }),
      ).resolves.toBeUndefined();
    });
  });
});

describe('EparagonyConnectionCredentialsShapeValidatorAdapter', () => {
  const validator = new EparagonyConnectionCredentialsShapeValidatorAdapter();

  it('should accept a client id and secret', async () => {
    await expect(
      validator.validate({ clientId: 'a', clientSecret: 'b' }),
    ).resolves.toBeUndefined();
  });

  it('should reject credentials missing the client secret', async () => {
    await expect(validator.validate({ clientId: 'a' })).rejects.toBeInstanceOf(
      InvalidCredentialsShapeException,
    );
  });

  it('should accept a well-formed integration id', async () => {
    await expect(
      validator.validate({ clientId: 'a', clientSecret: 'b', integrationId: 'openlinker:xyz' }),
    ).resolves.toBeUndefined();
  });

  it('should reject an integration id missing its separator', async () => {
    await expect(
      validator.validate({ clientId: 'a', clientSecret: 'b', integrationId: 'openlinker' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsShapeException);
  });

  it('should never echo a submitted secret in the error', async () => {
    const error: unknown = await validator
      .validate({ clientId: '', clientSecret: 'super-secret-value' })
      .then(() => null)
      .catch((e: unknown) => e);
    expect((error as Error).message).not.toContain('super-secret-value');
  });
});
