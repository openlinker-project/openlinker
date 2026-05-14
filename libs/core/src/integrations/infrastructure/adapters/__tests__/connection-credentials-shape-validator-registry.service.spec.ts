/**
 * Connection Credentials Shape Validator Registry — Unit Tests
 *
 * Pins the registry's contract: register / get / has, last-writer-wins on
 * duplicate adapterKey. Mirrors the sibling config-validator registry.
 *
 * @module libs/core/src/integrations/infrastructure/adapters/__tests__
 */
import { ConnectionCredentialsShapeValidatorRegistryService } from '../connection-credentials-shape-validator-registry.service';
import type { ConnectionCredentialsShapeValidatorPort } from '../../../domain/ports/connection-credentials-shape-validator.port';

describe('ConnectionCredentialsShapeValidatorRegistryService', () => {
  let registry: ConnectionCredentialsShapeValidatorRegistryService;

  const makeValidator = (tag: string): ConnectionCredentialsShapeValidatorPort => ({
    validate: jest.fn(() => {
      void tag;
      return Promise.resolve();
    }),
  });

  beforeEach(() => {
    registry = new ConnectionCredentialsShapeValidatorRegistryService();
  });

  it('returns the registered validator by adapterKey', () => {
    const validator = makeValidator('prestashop');
    registry.register('prestashop.webservice.v1', validator);

    expect(registry.get('prestashop.webservice.v1')).toBe(validator);
  });

  it('returns undefined for unknown adapterKey', () => {
    expect(registry.get('not-registered')).toBeUndefined();
  });

  it('reports has() correctly', () => {
    expect(registry.has('prestashop.webservice.v1')).toBe(false);
    registry.register('prestashop.webservice.v1', makeValidator('ps'));
    expect(registry.has('prestashop.webservice.v1')).toBe(true);
  });

  it('overwrites silently when the same adapterKey is registered twice', () => {
    const first = makeValidator('first');
    const second = makeValidator('second');
    registry.register('prestashop.webservice.v1', first);
    registry.register('prestashop.webservice.v1', second);

    expect(registry.get('prestashop.webservice.v1')).toBe(second);
  });
});
