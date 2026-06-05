/**
 * WooCommerce Connection Config DTO — SSRF Guard Tests
 *
 * Verifies that IsSsrfSafeUrlConstraint blocks all forms of private-IP
 * encoding, including decimal-integer and octal-octet bypass forms.
 *
 * @module libs/integrations/woocommerce/src/application/dto
 */
import { validate } from 'class-validator';
import { WooCommerceConnectionConfigDto } from './woocommerce-connection-config.dto';

async function isValid(url: string): Promise<boolean> {
  const dto = new WooCommerceConnectionConfigDto();
  dto.siteUrl = url;
  const errors = await validate(dto);
  return errors.length === 0;
}

describe('WooCommerceConnectionConfigDto — IsSsrfSafeUrlConstraint', () => {
  describe('decimal-integer encoded IPs', () => {
    it('should reject decimal-integer encoding of 127.0.0.1 (2130706433)', async () => {
      expect(await isValid('https://2130706433')).toBe(false);
    });

    it('should reject decimal-integer encoding of 192.168.0.1 (3232235521)', async () => {
      expect(await isValid('https://3232235521')).toBe(false);
    });
  });

  describe('octal-octet encoded IPs', () => {
    it('should reject octal encoding of 127.0.0.1 (0177.0.0.1)', async () => {
      expect(await isValid('https://0177.0.0.1')).toBe(false);
    });

    it('should reject octal encoding of 192.168.0.1 (0300.0250.0.1)', async () => {
      expect(await isValid('https://0300.0250.0.1')).toBe(false);
    });
  });

  describe('allowed addresses', () => {
    it('should allow a valid public HTTPS URL', async () => {
      expect(await isValid('https://myshop.example.com')).toBe(true);
    });

    it('should allow loopback with https (local dev)', async () => {
      expect(await isValid('https://127.0.0.1')).toBe(true);
    });

    it('should allow localhost with https', async () => {
      expect(await isValid('https://localhost')).toBe(true);
    });
  });

  describe('still blocked — pre-existing forms', () => {
    it('should reject hex-encoded private IP', async () => {
      expect(await isValid('https://0xc0a80001')).toBe(false);
    });

    it('should reject RFC-1918 address', async () => {
      expect(await isValid('https://192.168.1.100')).toBe(false);
    });
  });
});
