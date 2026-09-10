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

  it('should accept an operator-tuned first poll gap (#2840)', async () => {
    await expect(
      validator.validate({
        environment: 'sandbox',
        posId: 'p',
        statusPollInitialDelayMs: 2_000,
      }),
    ).resolves.toBeUndefined();
  });

  it('should reject a first poll gap that is not a positive number (#2840)', async () => {
    // The adapter clamps an unreadable value back to the shipped default, which
    // is the right RUNTIME behaviour and a silent one. Save time is where the
    // operator can still be told, so a mistyped gap is refused here rather than
    // taking effect as "no change" with nothing said.
    for (const bad of [0, -1, 'soon']) {
      await expect(
        validator.validate({
          environment: 'sandbox',
          posId: 'p',
          statusPollInitialDelayMs: bad,
        }),
      ).rejects.toBeInstanceOf(InvalidConnectionConfigException);
    }
  });

  it('should read an explicit null first poll gap as unset, not as invalid (#2840)', async () => {
    // Every optional key on this config already treats null exactly like
    // absent, and a cleared knob is written as an explicit null rather than
    // deleted (the #2610 shallow-spread rule). Refusing it here would make the
    // one act of clearing the field a 400.
    await expect(
      validator.validate({
        environment: 'sandbox',
        posId: 'p',
        statusPollInitialDelayMs: null as unknown as number,
      }),
    ).resolves.toBeUndefined();
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
