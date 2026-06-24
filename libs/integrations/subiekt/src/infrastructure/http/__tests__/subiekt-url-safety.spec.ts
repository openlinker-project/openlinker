/**
 * Subiekt URL Safety (SSRF predicate) — unit tests (#753)
 *
 * Pins the IMDS-block policy directly on the owning predicate: numeric-IPv4
 * encodings, IPv4-mapped IPv6 (incl. the hex-hextet form Node's URL parser
 * normalises to), and metadata hostnames must BLOCK; loopback + LAN must ALLOW.
 *
 * @module libs/integrations/subiekt/src/infrastructure/http/__tests__
 */
import { isBridgeUrlSafe } from '../subiekt-url-safety';

describe('isBridgeUrlSafe', () => {
  describe('blocks the IMDS (169.254.0.0/16) surface', () => {
    it.each([
      ['dotted-quad', 'http://169.254.169.254/'],
      ['decimal integer', 'http://2852039166/'],
      ['hex integer', 'http://0xA9FEA9FE/'],
      ['octal dotted', 'http://0251.0376.0251.0376/'],
      ['IPv4-mapped IPv6 (dotted)', 'http://[::ffff:169.254.169.254]/'],
      ['IPv4-mapped IPv6 (hex hextets)', 'http://[::ffff:a9fe:a9fe]/'],
    ])('blocks %s', (_label, url) => {
      expect(isBridgeUrlSafe(url)).toBe(false);
    });

    it.each([
      'http://metadata.google.internal',
      'http://metadata.internal',
      'http://metadata.azure.com',
      'http://METADATA.GOOGLE.INTERNAL',
    ])('blocks metadata hostname %s', (url) => {
      expect(isBridgeUrlSafe(url)).toBe(false);
    });
  });

  describe('allows the on-prem bridge surface (loopback + LAN)', () => {
    it.each([
      'http://192.168.1.10:5000',
      'http://10.0.0.5',
      'http://172.16.4.4',
      'http://127.0.0.1:8080',
      'http://localhost:5000',
      'http://[::1]/',
      'https://bridge.internal-lan.example/api',
    ])('allows %s', (url) => {
      expect(isBridgeUrlSafe(url)).toBe(true);
    });
  });

  describe('rejects non-http(s) and malformed input', () => {
    it.each([
      ['non-string', 42],
      ['null', null],
      ['unparseable', 'not a url'],
      ['file protocol', 'file:///etc/passwd'],
      ['ftp protocol', 'ftp://192.168.1.10'],
    ])('rejects %s', (_label, value) => {
      expect(isBridgeUrlSafe(value)).toBe(false);
    });
  });
});
