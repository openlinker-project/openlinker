/**
 * Mirakl Connection Shape Validators: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import {
  InvalidConnectionConfigException,
  InvalidCredentialsShapeException,
} from '@openlinker/core/integrations';
import { MiraklConnectionConfigShapeValidatorAdapter } from '../mirakl-connection-config-shape-validator.adapter';
import { MiraklConnectionCredentialsShapeValidatorAdapter } from '../mirakl-connection-credentials-shape-validator.adapter';

describe('MiraklConnectionCredentialsShapeValidatorAdapter', () => {
  const validator = new MiraklConnectionCredentialsShapeValidatorAdapter('Empik');

  it('should accept a non-empty apiKey', async () => {
    await expect(validator.validate({ apiKey: 'abc' })).resolves.toBeUndefined();
  });

  it.each([{}, { apiKey: '' }, { apiKey: '   ' }, { apiKey: 42 }])(
    'should refuse credentials %p',
    async (credentials) => {
      await expect(validator.validate(credentials)).rejects.toBeInstanceOf(
        InvalidCredentialsShapeException,
      );
    },
  );
});

describe('MiraklConnectionConfigShapeValidatorAdapter', () => {
  const validator = new MiraklConnectionConfigShapeValidatorAdapter('Empik');

  it('should accept an empty config', async () => {
    await expect(validator.validate({})).resolves.toBeUndefined();
  });

  it('should accept a full valid config with host-written keys', async () => {
    await expect(
      validator.validate({
        environment: 'staging',
        shopId: '6881',
        orderAcceptance: 'off',
        carrierCodes: { dpd: 'dpd' },
        offerDefaults: { leadTimeToShip: 2, logisticClass: '1' },
        masterCatalogConnectionId: '1f0e9a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b',
        rateLimit: { requestsPerMinute: 60 },
      }),
    ).resolves.toBeUndefined();
  });

  it('should name every invalid field when several are wrong', async () => {
    const error = (await validator
      .validate({
        environment: 'sandbox',
        shopId: 'x',
        baseUrl: 'https://evil.example',
        masterCatalogConnectionId: 'nope',
        orderAcceptance: 'manual',
        carrierCodes: { dpd: '' },
        offerDefaults: { leadTimeToShip: 99 },
      })
      .catch((e: unknown) => e)) as InvalidConnectionConfigException;

    expect(error).toBeInstanceOf(InvalidConnectionConfigException);
    expect(error.errors.map((issue) => issue.path).sort()).toEqual([
      'baseUrl',
      'carrierCodes',
      'environment',
      'masterCatalogConnectionId',
      'offerDefaults',
      'orderAcceptance',
      'shopId',
    ]);
  });
});
