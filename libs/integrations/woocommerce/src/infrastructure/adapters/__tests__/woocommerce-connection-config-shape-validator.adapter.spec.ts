/**
 * WooCommerce Connection Config Shape Validator Adapter — unit tests
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/__tests__
 */
import { InvalidConnectionConfigException } from '@openlinker/core/integrations';
import { WooCommerceConnectionConfigShapeValidatorAdapter } from '../woocommerce-connection-config-shape-validator.adapter';

describe('WooCommerceConnectionConfigShapeValidatorAdapter', () => {
  const validator = new WooCommerceConnectionConfigShapeValidatorAdapter();

  it('should pass when siteUrl is a valid https URL', async () => {
    await expect(
      validator.validate({ siteUrl: 'https://myshop.com' }),
    ).resolves.toBeUndefined();
  });

  it('should throw when siteUrl uses http (HTTPS required)', async () => {
    await expect(
      validator.validate({ siteUrl: 'http://myshop.com' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should pass when siteUrl is a localhost URL over https (local dev)', async () => {
    await expect(
      validator.validate({ siteUrl: 'https://localhost:8080' }),
    ).resolves.toBeUndefined();
  });

  it('should throw InvalidConnectionConfigException when siteUrl is missing', async () => {
    await expect(validator.validate({})).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should throw InvalidConnectionConfigException when siteUrl is not a URL', async () => {
    await expect(
      validator.validate({ siteUrl: 'not-a-url' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should throw InvalidConnectionConfigException when siteUrl has no protocol', async () => {
    await expect(
      validator.validate({ siteUrl: 'myshop.com' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should throw InvalidConnectionConfigException when siteUrl is an empty string', async () => {
    await expect(
      validator.validate({ siteUrl: '' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should pass when config carries extra keys alongside siteUrl', async () => {
    // whitelist: false — adjacent keys from future releases must not break validation
    await expect(
      validator.validate({ siteUrl: 'https://myshop.com', futureField: 'value' }),
    ).resolves.toBeUndefined();
  });

  // ── SSRF protection ───────────────────────────────────────────────────────

  it('should throw when siteUrl points to AWS metadata endpoint (169.254.169.254)', async () => {
    await expect(
      validator.validate({ siteUrl: 'https://169.254.169.254' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should throw when siteUrl points to a RFC-1918 address (10.x)', async () => {
    await expect(
      validator.validate({ siteUrl: 'https://10.0.0.1' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should throw when siteUrl points to a RFC-1918 address (192.168.x)', async () => {
    await expect(
      validator.validate({ siteUrl: 'https://192.168.1.50' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should throw when siteUrl points to a RFC-1918 address (172.16.x)', async () => {
    await expect(
      validator.validate({ siteUrl: 'https://172.16.0.1' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should throw when siteUrl uses hex-encoded IP bypass (0xc0a80001 = 192.168.0.1)', async () => {
    await expect(
      validator.validate({ siteUrl: 'https://0xc0a80001' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should throw when siteUrl uses IPv4-mapped IPv6 bypass (::ffff:192.168.1.1)', async () => {
    await expect(
      validator.validate({ siteUrl: 'https://[::ffff:192.168.1.1]' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should throw when siteUrl points to Azure metadata hostname', async () => {
    await expect(
      validator.validate({ siteUrl: 'https://metadata.azure.com' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should pass when siteUrl is localhost over https (loopback, allowed for local dev)', async () => {
    await expect(
      validator.validate({ siteUrl: 'https://localhost' }),
    ).resolves.toBeUndefined();
  });

  it('should pass when siteUrl is 127.0.0.1 over https (loopback, allowed for local dev)', async () => {
    await expect(
      validator.validate({ siteUrl: 'https://127.0.0.1' }),
    ).resolves.toBeUndefined();
  });
});
