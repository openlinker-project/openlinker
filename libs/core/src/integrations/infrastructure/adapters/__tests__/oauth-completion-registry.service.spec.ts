/**
 * OAuth Completion Registry Service — Unit Tests
 *
 * Pins the registry's contract: register / get / has + overwrite-on-duplicate,
 * the same shape the sibling registries exhibit. A regression here would
 * silently route the host's `OAuthConnectionService` to the wrong adapter
 * (or none), so the spec exists even though the surface is trivial (#859).
 *
 * @module libs/core/src/integrations/infrastructure/adapters/__tests__
 */
import { OAuthCompletionRegistryService } from '../oauth-completion-registry.service';
import type { OAuthCompletionPort } from '../../../domain/ports/oauth-completion.port';

describe('OAuthCompletionRegistryService', () => {
  let registry: OAuthCompletionRegistryService;

  const makeAdapter = (label: string): OAuthCompletionPort => ({
    buildAuthorizationUrl: jest.fn().mockReturnValue(`https://example.test/${label}`),
    exchangeCode: jest.fn().mockResolvedValue({ accessToken: label }),
    fetchAccountIdentity: jest.fn().mockResolvedValue({ accountId: label }),
  });

  beforeEach(() => {
    registry = new OAuthCompletionRegistryService();
  });

  describe('register / get', () => {
    it('returns the registered adapter by adapterKey', () => {
      const adapter = makeAdapter('a');
      registry.register('foo.v1', adapter);

      expect(registry.get('foo.v1')).toBe(adapter);
    });

    it('returns undefined for an unknown adapterKey', () => {
      expect(registry.get('not-registered')).toBeUndefined();
    });

    it('keeps registrations isolated per adapterKey', () => {
      const a = makeAdapter('a');
      const b = makeAdapter('b');
      registry.register('foo.v1', a);
      registry.register('bar.v1', b);

      expect(registry.get('foo.v1')).toBe(a);
      expect(registry.get('bar.v1')).toBe(b);
    });

    it('overwrites silently when the same adapterKey is registered twice', () => {
      const first = makeAdapter('first');
      const second = makeAdapter('second');
      registry.register('foo.v1', first);
      registry.register('foo.v1', second);

      expect(registry.get('foo.v1')).toBe(second);
    });
  });

  describe('has', () => {
    it('returns true when the adapterKey is registered', () => {
      registry.register('foo.v1', makeAdapter('a'));
      expect(registry.has('foo.v1')).toBe(true);
    });

    it('returns false when the adapterKey is not registered', () => {
      expect(registry.has('foo.v1')).toBe(false);
    });
  });
});
