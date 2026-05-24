/**
 * Auth Failure Classifier Registry Service — Unit Tests
 *
 * Pins the registry's contract: register / get / has + the OR-aggregating
 * `isCredentialRejected`. Mirrors `retry-classifier-registry.service.spec.ts`.
 * Regressions here would silently change which terminal failures flag a
 * connection for re-authentication (#819).
 *
 * @module libs/core/src/sync/infrastructure/adapters/__tests__
 */
import { AuthFailureClassifierRegistryService } from '../auth-failure-classifier-registry.service';
import type { AuthFailureClassifierPort } from '../../../domain/ports/auth-failure-classifier.port';

describe('AuthFailureClassifierRegistryService', () => {
  let registry: AuthFailureClassifierRegistryService;

  const makeClassifier = (matches: (cause: unknown) => boolean): AuthFailureClassifierPort => ({
    isCredentialRejected: jest.fn(matches),
  });

  beforeEach(() => {
    registry = new AuthFailureClassifierRegistryService();
  });

  describe('register / get / has', () => {
    it('returns the registered classifier by adapterKey', () => {
      const classifier = makeClassifier(() => false);
      registry.register('foo.v1', classifier);

      expect(registry.get('foo.v1')).toBe(classifier);
      expect(registry.has('foo.v1')).toBe(true);
    });

    it('returns undefined / false for unknown adapterKey', () => {
      expect(registry.get('not-registered')).toBeUndefined();
      expect(registry.has('not-registered')).toBe(false);
    });

    it('overwrites silently when the same adapterKey is registered twice', () => {
      const first = makeClassifier(() => false);
      const second = makeClassifier(() => true);
      registry.register('foo.v1', first);
      registry.register('foo.v1', second);

      expect(registry.get('foo.v1')).toBe(second);
    });
  });

  describe('isCredentialRejected aggregation', () => {
    class FooAuthError extends Error {}
    class BarError extends Error {}

    it('returns false when no classifiers are registered', () => {
      expect(registry.isCredentialRejected(new Error('boom'))).toBe(false);
    });

    it('returns false when no classifier matches', () => {
      registry.register(
        'foo.v1',
        makeClassifier((cause) => cause instanceof FooAuthError)
      );
      expect(registry.isCredentialRejected(new BarError())).toBe(false);
    });

    it('returns true when any classifier matches', () => {
      registry.register(
        'foo.v1',
        makeClassifier((cause) => cause instanceof FooAuthError)
      );
      registry.register(
        'bar.v1',
        makeClassifier((cause) => cause instanceof BarError)
      );

      expect(registry.isCredentialRejected(new FooAuthError())).toBe(true);
      expect(registry.isCredentialRejected(new BarError())).toBe(true);
    });

    it('passes the raw cause through to each classifier', () => {
      const matcher = jest.fn((cause: unknown) => cause instanceof FooAuthError);
      registry.register('foo.v1', { isCredentialRejected: matcher });

      const cause = new FooAuthError('specific message');
      registry.isCredentialRejected(cause);

      expect(matcher).toHaveBeenCalledWith(cause);
    });
  });
});
