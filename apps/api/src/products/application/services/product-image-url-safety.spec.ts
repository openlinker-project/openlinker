/**
 * The product-image proxy's host gate (#3415 review)
 *
 * Two halves, and the second matters as much as the first: the metadata
 * service is refused in every spelling it can be written in, AND the private
 * ranges the proxy exists to reach are still allowed. A change that tightened
 * this into `isUrlSsrfSafe` would pass the first half and switch the feature
 * off on every Docker-compose install, so both are asserted here.
 */
import { isProductImageUrlAllowed } from './product-image-url-safety';

const allowed = (url: string): boolean => isProductImageUrlAllowed(new URL(url));

describe('isProductImageUrlAllowed', () => {
  describe('the addresses this proxy must never reach', () => {
    it.each([
      ['dotted quad', 'http://169.254.169.254/latest/meta-data/'],
      ['packed decimal', 'http://2852039166/latest/meta-data/'],
      ['packed hex', 'http://0xa9fea9fe/latest/meta-data/'],
      ['dotted hex', 'http://0xa9.0xfe.0xa9.0xfe/'],
      ['dotted octal', 'http://0251.0376.0251.0376/'],
      ['IPv4-mapped IPv6', 'http://[::ffff:169.254.169.254]/'],
    ])('should refuse the cloud metadata service written as %s', (_form, url) => {
      expect(allowed(url)).toBe(false);
    });

    it.each([
      ['GCP', 'http://metadata.google.internal/computeMetadata/v1/'],
      ['GCP alternate', 'http://metadata.internal/'],
      ['Azure', 'http://metadata.azure.com/metadata/instance'],
    ])('should refuse the %s metadata host by name', (_cloud, url) => {
      // A hostname never reaches the address test, so naming it directly is a
      // separate bypass and needs its own refusal.
      expect(allowed(url)).toBe(false);
    });

    it('should refuse the whole link-local range, not only the metadata address', () => {
      expect(allowed('http://169.254.1.1/img.png')).toBe(false);
    });

    it('should refuse IPv6 link-local', () => {
      expect(allowed('http://[fe80::1]/img.png')).toBe(false);
    });

    it('should refuse the unspecified address, which reaches localhost on Linux', () => {
      expect(allowed('http://0.0.0.0:8080/img.png')).toBe(false);
    });

    it.each(['file:///etc/passwd', 'ftp://shop.example.com/img.png', 'gopher://x/'])(
      'should refuse the non-http scheme %s',
      (url) => {
        expect(allowed(url)).toBe(false);
      }
    );
  });

  describe('the addresses this proxy EXISTS to reach', () => {
    // Every one of these is measured, real demo data or the shape of it. A
    // future tightening that breaks this block has switched the feature off.
    it.each([
      ['the compose service name', 'http://prestashop/img/p/1/1.jpg'],
      ['the Docker host bridge', 'http://host.docker.internal:5056/img/p/2.jpg'],
      ['an RFC1918 /8 address', 'http://10.1.2.3/wp-content/uploads/a.jpg'],
      ['an RFC1918 /12 address', 'http://172.20.0.4/img.png'],
      ['an RFC1918 /16 address', 'http://192.168.1.50/img.png'],
      ['loopback', 'http://127.0.0.1:8080/img.png'],
      ['IPv6 loopback', 'http://[::1]:8080/img.png'],
      ['an IPv6 unique-local container address', 'http://[fd00::1]/img.png'],
      ['a public https CDN', 'https://cdn.shop.example.com/uploads/a.jpg'],
    ])('should allow %s', (_what, url) => {
      expect(allowed(url)).toBe(true);
    });
  });

  describe('the limits it does not pretend to close', () => {
    it('should allow a DNS name it cannot resolve, which is the stated rebinding gap', () => {
      // A name that resolves to the metadata address at fetch time passes a
      // hostname test by construction. Asserted so the limitation is visible
      // rather than discovered.
      expect(allowed('http://rebind.evil.example.com/img.png')).toBe(true);
    });
  });
});
