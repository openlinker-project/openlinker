/**
 * Email Normalizer Registry Service — Unit Tests
 *
 * Pins the registry's own contract: register / get / has / resolve, and
 * the silent-overwrite-on-duplicate-key semantics that sibling registries
 * (`WebhookProvisioningRegistryService`, `ConnectionTesterRegistryService`)
 * also exhibit. Also pins the `resolve()` fallback to
 * `DEFAULT_EMAIL_NORMALIZER` — `CustomerIdentityResolverService` relies on
 * that fallback to stay platform-agnostic when no per-platform normalizer
 * is registered (#585 / E5).
 *
 * @module libs/core/src/integrations/infrastructure/adapters/__tests__
 */
import { EmailNormalizerRegistryService } from '../email-normalizer-registry.service';
import { DEFAULT_EMAIL_NORMALIZER } from '../default-email-normalizer';
import { EmailNormalizerPort } from '../../../domain/ports/email-normalizer.port';

describe('EmailNormalizerRegistryService', () => {
  let registry: EmailNormalizerRegistryService;

  const makeNormalizer = (suffix: string): EmailNormalizerPort => ({
    normalize: jest.fn((email: string) => `${email}::${suffix}`),
  });

  beforeEach(() => {
    registry = new EmailNormalizerRegistryService();
  });

  describe('register / get', () => {
    it('returns the registered normalizer by adapterKey', () => {
      const normalizer = makeNormalizer('a');
      registry.register('foo.v1', normalizer);

      expect(registry.get('foo.v1')).toBe(normalizer);
    });

    it('returns undefined for unknown adapterKey', () => {
      expect(registry.get('not-registered')).toBeUndefined();
    });

    it('keeps registrations isolated per adapterKey', () => {
      const a = makeNormalizer('a');
      const b = makeNormalizer('b');
      registry.register('foo.v1', a);
      registry.register('bar.v1', b);

      expect(registry.get('foo.v1')).toBe(a);
      expect(registry.get('bar.v1')).toBe(b);
    });

    it('overwrites silently when the same adapterKey is registered twice', () => {
      // Mirrors WebhookProvisioningRegistryService — integration modules
      // register exactly once at boot, so a collision is a programming
      // bug, not a runtime concern. Contract: "last writer wins".
      const first = makeNormalizer('first');
      const second = makeNormalizer('second');
      registry.register('foo.v1', first);
      registry.register('foo.v1', second);

      expect(registry.get('foo.v1')).toBe(second);
    });
  });

  describe('has', () => {
    it('returns true when the adapterKey is registered', () => {
      registry.register('foo.v1', makeNormalizer('a'));
      expect(registry.has('foo.v1')).toBe(true);
    });

    it('returns false when the adapterKey is not registered', () => {
      expect(registry.has('foo.v1')).toBe(false);
    });
  });

  describe('resolve', () => {
    it('returns the registered normalizer for a known adapterKey', () => {
      const normalizer = makeNormalizer('platform');
      registry.register('foo.v1', normalizer);

      expect(registry.resolve('foo.v1')).toBe(normalizer);
    });

    it('falls back to DEFAULT_EMAIL_NORMALIZER for unknown adapterKey', () => {
      // The fallback is load-bearing: customer-identity resolution issues
      // an unconditional `resolve(...).normalize(email)`, so an unknown
      // key must yield the baseline trim+lowercase normalizer, not undefined.
      expect(registry.resolve('not-registered')).toBe(DEFAULT_EMAIL_NORMALIZER);
    });

    it('default normalizer trims and lowercases without platform branching', () => {
      // Proves the baseline is platform-agnostic — masked-email inputs
      // pass through unchanged, the Allegro `+transactionId` strip lives
      // only inside the Allegro adapter (#585 / E5).
      const fallback = registry.resolve('not-registered');
      expect(fallback.normalize('  Customer@Example.com  ')).toBe('customer@example.com');
      expect(fallback.normalize('abc+xyz@allegromail.pl')).toBe('abc+xyz@allegromail.pl');
    });
  });
});
