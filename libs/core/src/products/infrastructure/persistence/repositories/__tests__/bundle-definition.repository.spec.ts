/**
 * Bundle Definition Repository tests (#3520): the version-collision mapping.
 */
import { QueryFailedError } from 'typeorm';
import { BundleDefinitionConcurrentWriteError } from '../../../../domain/exceptions/bundle-definition.errors';
import { BundleDefinitionRepository, isVersionCollision } from '../bundle-definition.repository';

function uniqueViolation(constraint: string): QueryFailedError {
  return new QueryFailedError('INSERT', [], Object.assign(new Error('duplicate key'), { code: '23505', constraint }));
}

describe('BundleDefinitionRepository', () => {
  it('should recognise only the (variantId, version) unique violation', () => {
    expect(isVersionCollision(uniqueViolation('UQ_bundle_definitions_variant_version'))).toBe(true);
    expect(isVersionCollision(uniqueViolation('PK_bundle_definitions'))).toBe(false);
    expect(isVersionCollision(new Error('boom'))).toBe(false);
  });

  it('should raise a domain error instead of the raw driver error when two writers race', async () => {
    const orm = { query: jest.fn().mockRejectedValue(uniqueViolation('UQ_bundle_definitions_variant_version')) };
    const repository = new BundleDefinitionRepository(orm as never);

    await expect(repository.insertNextVersion('v-set', [])).rejects.toBeInstanceOf(
      BundleDefinitionConcurrentWriteError
    );
  });

  it('should let any other failure through untouched', async () => {
    const boom = new Error('connection lost');
    const orm = { query: jest.fn().mockRejectedValue(boom) };
    const repository = new BundleDefinitionRepository(orm as never);

    await expect(repository.insertNextVersion('v-set', [])).rejects.toBe(boom);
  });
});
