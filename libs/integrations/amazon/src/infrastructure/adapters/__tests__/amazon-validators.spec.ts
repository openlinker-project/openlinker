/**
 * Amazon config and credentials shape validator tests (#3741 foundation)
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/__tests__
 */
import {
  InvalidConnectionConfigException,
  InvalidCredentialsShapeException,
} from '@openlinker/core/integrations';

import { AmazonConnectionConfigShapeValidatorAdapter } from '../amazon-connection-config-shape-validator.adapter';
import { AmazonConnectionCredentialsShapeValidatorAdapter } from '../amazon-connection-credentials-shape-validator.adapter';

describe('AmazonConnectionConfigShapeValidatorAdapter', () => {
  const validator = new AmazonConnectionConfigShapeValidatorAdapter();

  it('should accept a valid config with unrelated keys beside it', async () => {
    await expect(
      validator.validate({ marketplaceIds: ['A1PA6795UKMFR9'], rateLimit: null }),
    ).resolves.toBeUndefined();
  });

  it('should reject with the flat issue list', async () => {
    const error = await validator.validate({ marketplaceIds: [] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidConnectionConfigException);
    expect((error as InvalidConnectionConfigException).errors[0].path).toBe('marketplaceIds');
  });
});

describe('AmazonConnectionCredentialsShapeValidatorAdapter', () => {
  const validator = new AmazonConnectionCredentialsShapeValidatorAdapter();

  it('should accept the three LWA values', async () => {
    await expect(
      validator.validate({ clientId: 'id', clientSecret: 's', refreshToken: 'Atzr|t' }),
    ).resolves.toBeUndefined();
  });

  it('should reject missing values', async () => {
    await expect(validator.validate({ clientId: 'id' })).rejects.toBeInstanceOf(InvalidCredentialsShapeException);
  });
});
