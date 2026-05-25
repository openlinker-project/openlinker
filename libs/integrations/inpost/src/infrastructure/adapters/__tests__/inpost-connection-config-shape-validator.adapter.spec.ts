/**
 * InPost Connection Config Shape Validator — unit tests
 *
 * @module libs/integrations/inpost/src/infrastructure/adapters
 */
import { InvalidConnectionConfigException } from '@openlinker/core/integrations';
import { InpostConnectionConfigShapeValidatorAdapter } from '../inpost-connection-config-shape-validator.adapter';

const validConfig: Record<string, unknown> = {
  environment: 'sandbox',
  organizationId: 'org-123',
  senderAddress: {
    name: 'Shop',
    email: 'shop@example.com',
    phone: '321321321',
    address: {
      street: 'Czerniakowska',
      buildingNumber: '87A',
      city: 'Warszawa',
      postCode: '00-718',
      countryCode: 'PL',
    },
  },
};

describe('InpostConnectionConfigShapeValidatorAdapter', () => {
  const validator = new InpostConnectionConfigShapeValidatorAdapter('InPost');

  it('should resolve for a well-formed config', async () => {
    await expect(validator.validate(validConfig)).resolves.toBeUndefined();
  });

  it('should throw when organizationId is missing', async () => {
    const config = { environment: validConfig.environment, senderAddress: validConfig.senderAddress };
    await expect(validator.validate(config)).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should throw for an invalid environment', async () => {
    await expect(validator.validate({ ...validConfig, environment: 'staging' })).rejects.toBeInstanceOf(
      InvalidConnectionConfigException,
    );
  });

  it('should throw for a malformed sender post code', async () => {
    const config = {
      ...validConfig,
      senderAddress: {
        ...(validConfig.senderAddress as Record<string, unknown>),
        address: {
          street: 'Czerniakowska',
          buildingNumber: '87A',
          city: 'Warszawa',
          postCode: '0071',
          countryCode: 'PL',
        },
      },
    };
    await expect(validator.validate(config)).rejects.toBeInstanceOf(InvalidConnectionConfigException);
  });
});
