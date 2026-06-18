/**
 * Erli base-URL policy — unit tests
 *
 * Exercises the SSRF allowlist guard directly: apex + subdomain Erli hosts pass,
 * non-https / off-host / look-alike hosts fail. Both the config-shape validator
 * and the adapter factory delegate here, so locking the helper locks both call
 * sites (#982 / PR1057-SUG-02).
 *
 * @module libs/integrations/erli/src/domain/policies/__tests__
 */
import { isAllowedErliBaseUrl, isAllowedErliHost } from '../erli-base-url.policy';

describe('erli-base-url.policy', () => {
  describe('isAllowedErliHost', () => {
    it.each(['erli.pl', 'erli.dev', 'sandbox.erli.dev', 'api.shop.erli.pl', 'ERLI.PL'])(
      'accepts Erli-owned host %s',
      (host) => {
        expect(isAllowedErliHost(host)).toBe(true);
      },
    );

    it.each(['evil.com', 'noterli.pl', 'erli.pl.evil.com', 'erlipl', 'erli.com'])(
      'rejects non-Erli host %s',
      (host) => {
        expect(isAllowedErliHost(host)).toBe(false);
      },
    );
  });

  describe('isAllowedErliBaseUrl', () => {
    it.each([
      'https://erli.pl/svc/shop-api',
      'https://sandbox.erli.dev/svc/shop-api',
    ])('accepts https Erli URL %s', (url) => {
      expect(isAllowedErliBaseUrl(url)).toBe(true);
    });

    it.each([
      'http://erli.pl/svc/shop-api', // not https
      'https://evil.example.com/svc', // off-host
      'https://erli.pl.evil.com/svc', // look-alike
      'not-a-url', // unparseable
      'ftp://erli.pl', // wrong protocol
    ])('rejects %s', (url) => {
      expect(isAllowedErliBaseUrl(url)).toBe(false);
    });
  });
});
