/**
 * Connection Config Shape Validator Registry — Unit Tests
 *
 * Pins the registry's contract: register / get / has, last-writer-wins on
 * duplicate adapterKey. Mirrors `EmailNormalizerRegistryService` /
 * `WebhookProvisioningRegistryService` so the behaviour is consistent
 * across host registries.
 *
 * @module libs/core/src/integrations/infrastructure/adapters/__tests__
 */
import { ConnectionConfigShapeValidatorRegistryService } from '../connection-config-shape-validator-registry.service';
import type { ConnectionConfigShapeValidatorPort } from '../../../domain/ports/connection-config-shape-validator.port';

describe('ConnectionConfigShapeValidatorRegistryService', () => {
  let registry: ConnectionConfigShapeValidatorRegistryService;

  const makeValidator = (tag: string): ConnectionConfigShapeValidatorPort => ({
    validate: jest.fn(() => {
      void tag;
      return Promise.resolve();
    }),
  });

  beforeEach(() => {
    registry = new ConnectionConfigShapeValidatorRegistryService();
  });

  describe('register / get', () => {
    it('returns the registered validator by adapterKey', () => {
      const validator = makeValidator('allegro');
      registry.register('allegro.publicapi.v1', validator);

      expect(registry.get('allegro.publicapi.v1')).toBe(validator);
    });

    it('returns undefined for unknown adapterKey', () => {
      expect(registry.get('not-registered')).toBeUndefined();
    });

    it('keeps registrations isolated per adapterKey', () => {
      const a = makeValidator('allegro');
      const b = makeValidator('prestashop');
      registry.register('allegro.publicapi.v1', a);
      registry.register('prestashop.webservice.v1', b);

      expect(registry.get('allegro.publicapi.v1')).toBe(a);
      expect(registry.get('prestashop.webservice.v1')).toBe(b);
    });

    it('overwrites silently when the same adapterKey is registered twice', () => {
      const first = makeValidator('first');
      const second = makeValidator('second');
      registry.register('allegro.publicapi.v1', first);
      registry.register('allegro.publicapi.v1', second);

      expect(registry.get('allegro.publicapi.v1')).toBe(second);
    });
  });

  describe('has', () => {
    it('returns true when the adapterKey is registered', () => {
      registry.register('allegro.publicapi.v1', makeValidator('allegro'));
      expect(registry.has('allegro.publicapi.v1')).toBe(true);
    });

    it('returns false when the adapterKey is not registered', () => {
      expect(registry.has('allegro.publicapi.v1')).toBe(false);
    });
  });
});
