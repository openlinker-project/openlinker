import {
  InvalidConnectionConfigException,
  InvalidCredentialsShapeException,
} from '@openlinker/core/integrations';

import { ShoperConnectionConfigShapeValidatorAdapter } from '../shoper-connection-config-shape-validator.adapter';
import { ShoperConnectionCredentialsShapeValidatorAdapter } from '../shoper-connection-credentials-shape-validator.adapter';

describe('ShoperConnectionConfigShapeValidatorAdapter', () => {
  const validator = new ShoperConnectionConfigShapeValidatorAdapter('Shoper');

  it('should accept a valid baseUrl and ignore adjacent keys', async () => {
    await expect(
      validator.validate({ baseUrl: 'xxxxx.shoparena.pl', rateLimit: { requestsPerMinute: 60 } }),
    ).resolves.toBeUndefined();
  });

  it('should accept order defaults that are positive integers, or unset', async () => {
    await expect(
      validator.validate({
        baseUrl: 'xxxxx.shoparena.pl',
        defaults: { shippingId: 8, paymentId: '1', statusId: null },
      }),
    ).resolves.toBeUndefined();
  });

  it('should reject an order default that is not a positive integer', async () => {
    const error = await validator
      .validate({ baseUrl: 'xxxxx.shoparena.pl', defaults: { shippingId: 0, paymentId: 'cash' } })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidConnectionConfigException);
    expect((error as InvalidConnectionConfigException).errors.map((e) => e.path)).toEqual([
      'defaults.shippingId',
      'defaults.paymentId',
    ]);
  });

  it('should reject defaults that is not an object', async () => {
    const error = await validator
      .validate({ baseUrl: 'xxxxx.shoparena.pl', defaults: 5 })
      .catch((e: unknown) => e);

    expect((error as InvalidConnectionConfigException).errors).toEqual([
      { path: 'defaults', message: 'must be an object' },
    ]);
  });

  it.each([[undefined], [null], [''], ['https://openlinker.example.com'], ['http://host.docker.internal:3000']])(
    'should accept the callback URL %p',
    async (callback) => {
      await expect(
        validator.validate({ baseUrl: 'sklep729770.shoparena.pl', openlinkerCallbackBaseUrl: callback }),
      ).resolves.toBeUndefined();
    },
  );

  it.each([
    ['not a URL', 'not a url', 'must be a valid URL'],
    ['a non-http scheme', 'ftp://openlinker.example.com', 'must use http:// or https://'],
    ['a non-string', 42, 'must be a string'],
  ])('should reject a callback URL that is %s, naming the key', async (_name, callback, message) => {
    await expect(
      validator.validate({ baseUrl: 'sklep729770.shoparena.pl', openlinkerCallbackBaseUrl: callback }),
    ).rejects.toMatchObject({
      errors: [{ path: 'openlinkerCallbackBaseUrl', message }],
    });
  });

  it('should reject a missing baseUrl with a path-tagged issue', async () => {
    const error = await validator.validate({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidConnectionConfigException);
    expect((error as InvalidConnectionConfigException).errors).toEqual([
      { path: 'baseUrl', message: expect.stringContaining('non-empty string') },
    ]);
  });

  it.each(['http://xxxxx.shoparena.pl', 'xxxxx.shoparena.pl/path', '10.0.0.1', 'localhost'])(
    'should reject a malformed baseUrl %p',
    async (baseUrl) => {
      await expect(validator.validate({ baseUrl })).rejects.toBeInstanceOf(
        InvalidConnectionConfigException,
      );
    },
  );
});

describe('ShoperConnectionCredentialsShapeValidatorAdapter', () => {
  const validator = new ShoperConnectionCredentialsShapeValidatorAdapter('Shoper');

  it('should accept a non-empty token', async () => {
    await expect(validator.validate({ token: 'abc123' })).resolves.toBeUndefined();
  });

  it.each([
    ['missing', {}],
    ['empty', { token: '' }],
    ['whitespace', { token: '   ' }],
    ['not a string', { token: 12345 }],
  ])('should reject a %s token', async (_label, credentials) => {
    await expect(validator.validate(credentials)).rejects.toBeInstanceOf(
      InvalidCredentialsShapeException,
    );
  });

  it('should not echo a rejected value into the error', async () => {
    const error = await validator.validate({ token: 12345 }).catch((e: unknown) => e);
    expect((error as Error).message).not.toContain('12345');
  });
});
