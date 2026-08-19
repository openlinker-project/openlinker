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
 * @module libs/integrations/infakt/src/domain/policies/__tests__
 */
import {
  INFAKT_DEFAULT_BASE_URL,
  INFAKT_SANDBOX_BASE_URL,
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

  it('should resolve to the default production host when environment is production', () => {
    const config: InfaktConnectionConfig = { environment: 'production' };

    expect(resolveInfaktBaseUrl(config)).toBe(INFAKT_DEFAULT_BASE_URL);
  });

  it('should resolve to the default production host when neither baseUrl nor environment is set', () => {
    expect(resolveInfaktBaseUrl({})).toBe(INFAKT_DEFAULT_BASE_URL);
  });
});
