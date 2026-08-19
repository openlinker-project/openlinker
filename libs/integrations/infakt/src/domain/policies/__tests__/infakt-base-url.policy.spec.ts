/**
 * Infakt base-URL policy - unit tests
 *
 * Exercises `resolveInfaktBaseUrl`'s precedence directly (#2179 review): a
 * legacy `config.baseUrl` wins over `environment`, `environment: 'sandbox'`
 * resolves to the sandbox host, and everything else (including an entirely
 * empty config) falls back to production. Previously only exercised
 * indirectly through `infakt-adapter.factory.spec.ts` and
 * `infakt-connection-tester.adapter.spec.ts`, both of which assert on the
 * constructed HTTP client's resolved URL rather than the pure function
 * itself.
 *
 * Also covers the https guard on the legacy override and the trimming of a
 * padded override (#2179 review round 3, Important #1 + Suggestion #1).
 *
 * @module libs/integrations/infakt/src/domain/policies/__tests__
 */
import { InfaktConfigException } from '../../exceptions/infakt-config.exception';
import {
  INFAKT_DEFAULT_BASE_URL,
  INFAKT_SANDBOX_BASE_URL,
  isAllowedInfaktBaseUrl,
  resolveInfaktBaseUrl,
} from '../infakt-base-url.policy';
import type { InfaktConnectionConfig } from '../../types/infakt-connection.types';

describe('resolveInfaktBaseUrl', () => {
  it('should return the explicit baseUrl when both baseUrl and environment are present', () => {
    const config: InfaktConnectionConfig = {
      baseUrl: 'https://custom.infakt.example/api/v3',
      environment: 'sandbox',
    };

    expect(resolveInfaktBaseUrl(config)).toBe('https://custom.infakt.example/api/v3');
  });

  it('should resolve to the sandbox host when environment is sandbox and no baseUrl is set', () => {
    const config: InfaktConnectionConfig = { environment: 'sandbox' };

    expect(resolveInfaktBaseUrl(config)).toBe(INFAKT_SANDBOX_BASE_URL);
  });

  // Asserted against a hardcoded literal (not just the constant re-export) per
  // #2179 review: inFakt's sandbox is a separate domain (api.sandbox-infakt.pl,
  // hyphen), not a subdomain (api.sandbox.infakt.pl) - a prior version of this
  // constant had the wrong host and no test caught it because every assertion
  // compared the constant against itself.
  it('should resolve the sandbox host to the correct hyphenated domain', () => {
    expect(resolveInfaktBaseUrl({ environment: 'sandbox' })).toBe(
      'https://api.sandbox-infakt.pl/api/v3',
    );
  });

  it('should resolve to the default production host when environment is production', () => {
    const config: InfaktConnectionConfig = { environment: 'production' };

    expect(resolveInfaktBaseUrl(config)).toBe(INFAKT_DEFAULT_BASE_URL);
  });

  it('should resolve to the default production host when neither baseUrl nor environment is set', () => {
    expect(resolveInfaktBaseUrl({})).toBe(INFAKT_DEFAULT_BASE_URL);
  });

  it('should treat a whitespace-only baseUrl as absent and fall through to environment', () => {
    const config: InfaktConnectionConfig = { baseUrl: '   ', environment: 'sandbox' };

    expect(resolveInfaktBaseUrl(config)).toBe(INFAKT_SANDBOX_BASE_URL);
  });

  it('should trim surrounding whitespace off an explicit baseUrl', () => {
    const config: InfaktConnectionConfig = { baseUrl: '  https://api.infakt.example/api/v3  ' };

    expect(resolveInfaktBaseUrl(config)).toBe('https://api.infakt.example/api/v3');
  });

  describe('https guard on the legacy override (#2179 review round 3, Important #1)', () => {
    it('should throw InfaktConfigException when the baseUrl override is plain http', () => {
      const config: InfaktConnectionConfig = { baseUrl: 'http://attacker.example/api/v3' };

      expect(() => resolveInfaktBaseUrl(config, 'conn-1')).toThrow(InfaktConfigException);
    });

    it('should name the offending connection in the thrown message', () => {
      const config: InfaktConnectionConfig = { baseUrl: 'http://attacker.example/api/v3' };

      expect(() => resolveInfaktBaseUrl(config, 'conn-1')).toThrow(/conn-1/);
    });

    it('should still resolve a valid https override', () => {
      const config: InfaktConnectionConfig = { baseUrl: 'https://proxy.example/api/v3' };

      expect(resolveInfaktBaseUrl(config, 'conn-1')).toBe('https://proxy.example/api/v3');
    });

    it('should throw rather than fall through to the environment default', () => {
      const config: InfaktConnectionConfig = {
        baseUrl: 'http://attacker.example/api/v3',
        environment: 'sandbox',
      };

      expect(() => resolveInfaktBaseUrl(config, 'conn-1')).toThrow(InfaktConfigException);
    });
  });
});

describe('isAllowedInfaktBaseUrl', () => {
  it('should accept an https URL on any host', () => {
    expect(isAllowedInfaktBaseUrl('https://api.infakt.pl/api/v3')).toBe(true);
    // Deliberately host-agnostic: the legacy override may target an operator proxy.
    expect(isAllowedInfaktBaseUrl('https://proxy.internal.example/api/v3')).toBe(true);
  });

  it('should reject a plain-http URL', () => {
    expect(isAllowedInfaktBaseUrl('http://api.infakt.pl/api/v3')).toBe(false);
  });

  it('should reject a non-URL string', () => {
    expect(isAllowedInfaktBaseUrl('not-a-url')).toBe(false);
  });
});
