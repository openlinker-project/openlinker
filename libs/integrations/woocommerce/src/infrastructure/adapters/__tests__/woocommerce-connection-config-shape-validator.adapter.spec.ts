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

  it('should pass when siteUrl is a valid http URL', async () => {
    await expect(
      validator.validate({ siteUrl: 'http://myshop.com' }),
    ).resolves.toBeUndefined();
  });

  it('should pass when siteUrl is a localhost URL', async () => {
    await expect(
      validator.validate({ siteUrl: 'http://localhost:8080' }),
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

  // ── SSRF protection (#876) ────────────────────────────────────────────────

  it('should throw when siteUrl points to AWS metadata endpoint (169.254.169.254)', async () => {
    await expect(
      validator.validate({ siteUrl: 'http://169.254.169.254' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should throw when siteUrl points to a RFC-1918 address (10.x)', async () => {
    await expect(
      validator.validate({ siteUrl: 'http://10.0.0.1' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should throw when siteUrl points to a RFC-1918 address (192.168.x)', async () => {
    await expect(
      validator.validate({ siteUrl: 'http://192.168.1.50' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should throw when siteUrl points to a RFC-1918 address (172.16.x)', async () => {
    await expect(
      validator.validate({ siteUrl: 'http://172.16.0.1' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should throw when siteUrl uses hex-encoded IP bypass (0xc0a80001 = 192.168.0.1)', async () => {
    await expect(
      validator.validate({ siteUrl: 'http://0xc0a80001' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should throw when siteUrl uses IPv4-mapped IPv6 bypass (::ffff:192.168.1.1)', async () => {
    await expect(
      validator.validate({ siteUrl: 'http://[::ffff:192.168.1.1]' }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should pass when siteUrl is localhost (allowed for local dev)', async () => {
    await expect(
      validator.validate({ siteUrl: 'http://localhost' }),
    ).resolves.toBeUndefined();
  });

  it('should pass when siteUrl is 127.0.0.1 (loopback, allowed for local dev)', async () => {
    await expect(
      validator.validate({ siteUrl: 'http://127.0.0.1' }),
    ).resolves.toBeUndefined();
  });

  // ── orders.initialSyncFrom validation (#876) ──────────────────────────────

  it('should pass when orders.initialSyncFrom is a valid date string', async () => {
    await expect(
      validator.validate({ siteUrl: 'https://myshop.com', orders: { initialSyncFrom: '2024-01-01' } }),
    ).resolves.toBeUndefined();
  });

  it('should pass when orders.initialSyncFrom is a full ISO date string', async () => {
    await expect(
      validator.validate({ siteUrl: 'https://myshop.com', orders: { initialSyncFrom: '2024-01-01T00:00:00Z' } }),
    ).resolves.toBeUndefined();
  });

  it('should throw when orders.initialSyncFrom is not a parseable date', async () => {
    await expect(
      validator.validate({ siteUrl: 'https://myshop.com', orders: { initialSyncFrom: 'not-a-date' } }),
    ).rejects.toThrow(InvalidConnectionConfigException);
  });

  it('should pass when orders field is absent entirely', async () => {
    await expect(
      validator.validate({ siteUrl: 'https://myshop.com' }),
    ).resolves.toBeUndefined();
  });
});
