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

  it('should refuse an update that changes the region', async () => {
    const error = await validator
      .validate({ region: 'na', marketplaceIds: ['ATVPDKIKX0DER'] }, { previous: { region: 'eu' } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidConnectionConfigException);
    expect((error as InvalidConnectionConfigException).errors.map((issue) => issue.path)).toEqual(['region']);
  });

  it('should refuse an update that changes the environment', async () => {
    const error = await validator
      .validate(
        { region: 'na', environment: 'production', marketplaceIds: ['ATVPDKIKX0DER'] },
        { previous: { region: 'na', environment: 'sandbox' } },
      )
      .catch((e: unknown) => e);
    expect((error as InvalidConnectionConfigException).errors.map((issue) => issue.path)).toEqual(['environment']);
  });

  it('should refuse an update that swaps the marketplace in the fe region', async () => {
    const error = await validator
      .validate(
        { region: 'fe', marketplaceIds: ['A39IBJ37TRP1C6'] },
        { previous: { region: 'fe', marketplaceIds: ['A1VC38T7YXB528'] } },
      )
      .catch((e: unknown) => e);
    expect((error as InvalidConnectionConfigException).errors.map((issue) => issue.path)).toEqual(['marketplaceIds']);
  });

  it('should accept a create in any region, since there is no stored region yet', async () => {
    await expect(
      validator.validate({ region: 'na', marketplaceIds: ['ATVPDKIKX0DER'] }),
    ).resolves.toBeUndefined();
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
