/**
 * Retry Classifier Registry Service — Unit Tests
 *
 * Pins the registry's contract: register / get / has + the OR-aggregating
 * `isNonRetryable`. Sibling registries (`ConnectionTesterRegistryService`,
 * `WebhookProvisioningRegistryService`) are similarly pinned. Regressions
 * here would silently re-classify retry behaviour for every adapter, so
 * the spec exists even though the surface is small (#581).
 *
 * @module libs/core/src/sync/infrastructure/adapters/__tests__
 */
import { RetryClassifierRegistryService } from '../retry-classifier-registry.service';
import type { RetryClassifierPort } from '../../../domain/ports/retry-classifier.port';

describe('RetryClassifierRegistryService', () => {
  let registry: RetryClassifierRegistryService;

  const makeClassifier = (matches: (cause: unknown) => boolean): RetryClassifierPort => ({
    isNonRetryable: jest.fn(matches),
  });

  beforeEach(() => {
    registry = new RetryClassifierRegistryService();
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
      // Mirrors ConnectionTesterRegistryService — integration modules
      // register exactly once at boot, so a collision is a programming
      // bug, not a runtime concern. Last writer wins.
      const first = makeClassifier(() => false);
      const second = makeClassifier(() => true);
      registry.register('foo.v1', first);
      registry.register('foo.v1', second);

      expect(registry.get('foo.v1')).toBe(second);
    });
  });

  describe('isNonRetryable aggregation', () => {
    class FooError extends Error {}
    class BarError extends Error {}

    it('returns false when no classifiers are registered', () => {
      expect(registry.isNonRetryable(new Error('boom'))).toBe(false);
    });

    it('returns false when no classifier matches', () => {
      registry.register(
        'foo.v1',
        makeClassifier((cause) => cause instanceof FooError)
      );
      registry.register(
        'bar.v1',
        makeClassifier((cause) => cause instanceof BarError)
      );

      expect(registry.isNonRetryable(new Error('unknown'))).toBe(false);
    });

    it('returns true when any classifier matches', () => {
      registry.register(
        'foo.v1',
        makeClassifier((cause) => cause instanceof FooError)
      );
      registry.register(
        'bar.v1',
        makeClassifier((cause) => cause instanceof BarError)
      );

      expect(registry.isNonRetryable(new FooError())).toBe(true);
      expect(registry.isNonRetryable(new BarError())).toBe(true);
    });

    it('passes the raw cause through to each classifier', () => {
      const fooMatcher = jest.fn((cause: unknown) => cause instanceof FooError);
      registry.register('foo.v1', { isNonRetryable: fooMatcher });

      const cause = new FooError('specific message');
      registry.isNonRetryable(cause);

      expect(fooMatcher).toHaveBeenCalledWith(cause);
    });
  });
});
