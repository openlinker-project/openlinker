/**
 * DPD Connection Config Shape Validator — unit tests
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/adapters
 */
import { InvalidConnectionConfigException } from '@openlinker/core/integrations';
import { DpdConnectionConfigShapeValidatorAdapter } from '../dpd-connection-config-shape-validator.adapter';

const validConfig: Record<string, unknown> = {
  environment: 'sandbox',
  payerFid: '1495',
  senderAddress: {
    name: 'Sklep ACME',
    address: 'Magazynowa 1',
    city: 'Warszawa',
    postalCode: '00-001',
    countryCode: 'PL',
    phone: '+48111222333',
    email: 'sklep@example.com',
  },
};

describe('DpdConnectionConfigShapeValidatorAdapter', () => {
  const validator = new DpdConnectionConfigShapeValidatorAdapter('DPD Polska');

  it('should resolve for a well-formed config', async () => {
    await expect(validator.validate(validConfig)).resolves.toBeUndefined();
  });

  it('should resolve when masterFid is present and numeric', async () => {
    await expect(validator.validate({ ...validConfig, masterFid: '12345' })).resolves.toBeUndefined();
  });

  it('should throw when payerFid is non-numeric', async () => {
    await expect(validator.validate({ ...validConfig, payerFid: 'abc' })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should throw when payerFid is missing', async () => {
    const config = { environment: validConfig.environment, senderAddress: validConfig.senderAddress };
    await expect(validator.validate(config)).rejects.toBeInstanceOf(InvalidConnectionConfigException);
  });

  it('should throw for an invalid environment', async () => {
    await expect(validator.validate({ ...validConfig, environment: 'staging' })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should throw for a malformed sender postal code', async () => {
    const config = {
      ...validConfig,
      senderAddress: {
        ...(validConfig.senderAddress as Record<string, unknown>),
        postalCode: '0001',
      },
    };
    await expect(validator.validate(config)).rejects.toBeInstanceOf(InvalidConnectionConfigException);
  });

  it('should throw when masterFid is present but non-numeric', async () => {
    await expect(validator.validate({ ...validConfig, masterFid: 'xx' })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });
});
