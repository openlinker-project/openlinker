/**
 * WooCommerce Connection Config DTO — SSRF guard unit tests
 *
 * Exercises `IsSsrfSafeUrlConstraint` directly (the canonical SSRF guard the
 * rest of the plugin fleet copies). Each known IPv4-literal bypass class
 * (dotted private, loopback, hex, IPv4-mapped IPv6, decimal-integer, octal)
 * is asserted, plus a normal public https URL is accepted.
 *
 * @module libs/integrations/woocommerce/src/application/dto/__tests__
 */
// Required so the DTO's class-transformer `@Type` decorator can read metadata
// when this spec imports the module in isolation.
import 'reflect-metadata';
import { IsSsrfSafeUrlConstraint } from '../woocommerce-connection-config.dto';

describe('IsSsrfSafeUrlConstraint', () => {
  const guard = new IsSsrfSafeUrlConstraint();
  const accept = (url: string): boolean => guard.validate(url);

  describe('accepts legitimate URLs', () => {
    it('should accept a normal public https URL', () => {
      expect(accept('https://myshop.example.com')).toBe(true);
    });

    it('should accept loopback (127.0.0.1) for local dev', () => {
      expect(accept('https://127.0.0.1')).toBe(true);
    });

    it('should accept localhost for local dev', () => {
      expect(accept('https://localhost')).toBe(true);
    });

    it('should accept IPv6 loopback ([::1]) for local dev', () => {
      expect(accept('https://[::1]')).toBe(true);
    });
  });

  describe('rejects private / link-local IPs in dotted-quad form', () => {
    it.each(['https://10.0.0.1', 'https://172.16.0.1', 'https://192.168.1.50', 'https://169.254.169.254'])(
      'should reject %s',
      (url) => {
        expect(accept(url)).toBe(false);
      },
    );
  });

  describe('rejects IPv4-literal SSRF bypass encodings', () => {
    it('should reject hex-encoded private IP (0xc0a80001 = 192.168.0.1)', () => {
      expect(accept('https://0xc0a80001')).toBe(false);
    });

    it('should reject IPv4-mapped IPv6 (::ffff:192.168.1.1)', () => {
      expect(accept('https://[::ffff:192.168.1.1]')).toBe(false);
    });

    it('should reject decimal-integer encoding of a private IP (3232235521 = 192.168.0.1)', () => {
      expect(accept('https://3232235521')).toBe(false);
    });

    it('should reject decimal-integer encoding of link-local metadata (2852039166 = 169.254.169.254)', () => {
      expect(accept('https://2852039166')).toBe(false);
    });

    it('should reject octal-encoded private IP (0012.0.0.1 = 10.0.0.1)', () => {
      expect(accept('https://0012.0.0.1')).toBe(false);
    });

    it('should reject hex-part dotted IP (0xa.0.0.1 = 10.0.0.1)', () => {
      expect(accept('https://0xa.0.0.1')).toBe(false);
    });
  });

  describe('rejects cloud-metadata hostnames and malformed input', () => {
    it('should reject the Azure metadata hostname', () => {
      expect(accept('https://metadata.azure.com')).toBe(false);
    });

    it('should reject a non-string value', () => {
      expect(guard.validate(42)).toBe(false);
    });

    it('should reject an unparseable URL', () => {
      expect(accept('not-a-url')).toBe(false);
    });
  });
});
