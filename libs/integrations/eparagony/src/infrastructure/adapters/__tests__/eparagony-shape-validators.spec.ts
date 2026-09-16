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

  // The invoicing keys (#3192). Every one of them is transmitted onto a fiscal
  // document AND persisted into the issued-document snapshot, and the connection
  // form emits only `{environment, posId}` - so the raw JSON editor is the
  // operator's route to all four and this validator is the only check in front
  // of it.
  const BASE = { environment: 'sandbox', posId: 'p' } as const;
  const ADDRESS = {
    street: 'ul. Grzybowska',
    number: '2',
    postalCode: '00-131',
    city: 'Warszawa',
    country: 'PL',
  } as const;

  it('should accept a fully configured seller party', async () => {
    await expect(
      validator.validate({
        ...BASE,
        merchantTIN: '5252556107',
        merchantName: 'OpenLinker POC Sp. z o.o.',
        merchantAddress: { ...ADDRESS, apartment: '45' },
        eInvoicingHubEnabled: true,
      }),
    ).resolves.toBeUndefined();
  });

  it('should accept a connection that configures no invoicing keys at all', async () => {
    // Every connection that exists today is receipts-only and carries none of
    // them; the invoice mapper is what refuses at issue time.
    await expect(validator.validate({ ...BASE })).resolves.toBeUndefined();
  });

  it('should reject a blank seller tax number rather than transmitting whitespace', async () => {
    await expect(validator.validate({ ...BASE, merchantTIN: '   ' })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
    await expect(validator.validate({ ...BASE, merchantTIN: 5252556107 })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should reject a blank seller name', async () => {
    await expect(validator.validate({ ...BASE, merchantName: '' })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it.each(['street', 'number', 'postalCode', 'city', 'country'])(
    'should reject a seller address missing %s, because a partial one renders "undefined" onto the document',
    async (field) => {
      const partial: Record<string, unknown> = { ...ADDRESS };
      delete partial[field];
      await expect(
        validator.validate({ ...BASE, merchantAddress: partial }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    },
  );

  it('should name the missing address part rather than only the object', async () => {
    const error = await validator
      .validate({ ...BASE, merchantAddress: { ...ADDRESS, city: '' } })
      .then(() => null)
      .catch((e: unknown) => e as InvalidConnectionConfigException);
    expect(error?.errors.map((issue) => issue.path)).toContain('merchantAddress.city');
  });

  it('should reject a seller address that is not an object', async () => {
    await expect(
      validator.validate({ ...BASE, merchantAddress: 'ul. Grzybowska 2' }),
    ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    await expect(validator.validate({ ...BASE, merchantAddress: [] })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should reject a blank apartment while accepting an absent one', async () => {
    await expect(
      validator.validate({ ...BASE, merchantAddress: { ...ADDRESS, apartment: '  ' } }),
    ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    await expect(
      validator.validate({ ...BASE, merchantAddress: ADDRESS }),
    ).resolves.toBeUndefined();
  });

  it('should reject a STRING hub flag, which would silently issue outside the hub', async () => {
    // The adapter tests `=== true`, so "true" reads as false: the invoice is
    // issued outside the national hub with no error anywhere - a legally
    // different document. Refusing is the only way the operator learns.
    await expect(
      validator.validate({ ...BASE, eInvoicingHubEnabled: 'true' }),
    ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    await expect(validator.validate({ ...BASE, eInvoicingHubEnabled: 1 })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should never echo a submitted seller value back in the issue list', async () => {
    // The issues reach the operator's browser as a 400 body, so they name the
    // PATH and never the value - the rule the credentials validator holds too.
    const error = await validator
      .validate({ ...BASE, merchantTIN: '   ', merchantName: 'Secret Trading Sp. z o.o.' })
      .then(() => null)
      .catch((e: unknown) => e as InvalidConnectionConfigException);
    const rendered = `${error?.message} ${JSON.stringify(error?.errors)}`;
    expect(rendered).not.toContain('Secret Trading');
    expect(error?.errors.map((issue) => issue.path)).toContain('merchantTIN');
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
