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
 * The "/api/v3 normalization" block (#2176) covers the bare-host override the
 * README's historical example produced, and is deliberately narrow: it must
 * NOT rewrite an override that already carries its own path, since that shape
 * is an operator-run proxy per `isAllowedInfaktBaseUrl`'s own docblock, not a
 * broken README example (#2176 review, Important #1). A composed-URL
 * assertion for the exact corrected README shape lives in
 * `infakt-connection-tester.adapter.spec.ts` (#2176 review, Important #2) -
 * this file only asserts the pure function's return string, which does not by
 * itself cover the `InfaktHttpClient` composition the original bug was in.
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

describe('resolveInfaktBaseUrl - /api/v3 normalization (#2176)', () => {
  it('should append /api/v3 to an override that omits it', () => {
    const config: InfaktConnectionConfig = { baseUrl: 'https://api.sandbox-infakt.pl' };

    expect(resolveInfaktBaseUrl(config)).toBe('https://api.sandbox-infakt.pl/api/v3');
  });

  it('should not double-append /api/v3 to an override that already ends with it', () => {
    const config: InfaktConnectionConfig = { baseUrl: 'https://api.sandbox-infakt.pl/api/v3' };

    expect(resolveInfaktBaseUrl(config)).toBe('https://api.sandbox-infakt.pl/api/v3');
  });

  it('should strip a trailing slash before appending /api/v3', () => {
    const config: InfaktConnectionConfig = { baseUrl: 'https://api.sandbox-infakt.pl/' };

    expect(resolveInfaktBaseUrl(config)).toBe('https://api.sandbox-infakt.pl/api/v3');
  });

  it('should not double-append when the override ends with /api/v3 and a trailing slash', () => {
    const config: InfaktConnectionConfig = { baseUrl: 'https://api.sandbox-infakt.pl/api/v3/' };

    expect(resolveInfaktBaseUrl(config)).toBe('https://api.sandbox-infakt.pl/api/v3');
  });

  // #2176 review, Important #1: an override carrying its own path is an
  // operator-run proxy (see `isAllowedInfaktBaseUrl`'s docblock), not a broken
  // README-example shape, and must be honoured verbatim - even when its own
  // path does not end in `/api/v3`.
  it('should leave an override mounted under its own proxy prefix untouched', () => {
    const config: InfaktConnectionConfig = { baseUrl: 'https://proxy.example.com/infakt' };

    expect(resolveInfaktBaseUrl(config)).toBe('https://proxy.example.com/infakt');
  });

  it('should leave a root-mounted proxy override with its own path untouched, trimming only the trailing slash', () => {
    const config: InfaktConnectionConfig = { baseUrl: 'https://proxy.example.com/infakt/' };

    expect(resolveInfaktBaseUrl(config)).toBe('https://proxy.example.com/infakt');
  });

  it('should not treat a query string after /api/v3 as needing a second suffix', () => {
    const config: InfaktConnectionConfig = { baseUrl: 'https://api.sandbox-infakt.pl/api/v3?probe=1' };

    expect(resolveInfaktBaseUrl(config)).toBe('https://api.sandbox-infakt.pl/api/v3?probe=1');
  });

  it('should not treat a path merely containing the /api/v3 substring as already suffixed', () => {
    const config: InfaktConnectionConfig = { baseUrl: 'https://proxy.example.com/not-api/v3' };

    expect(resolveInfaktBaseUrl(config)).toBe('https://proxy.example.com/not-api/v3');
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
