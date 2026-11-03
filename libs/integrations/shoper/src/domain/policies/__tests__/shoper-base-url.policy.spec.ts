import { buildShoperApiUrl, parseShoperBaseUrl } from '../shoper-base-url.policy';

describe('parseShoperBaseUrl', () => {
  it.each([
    ['xxxxx.shoparena.pl', 'xxxxx.shoparena.pl'],
    ['  XXXXX.ShopArena.PL  ', 'xxxxx.shoparena.pl'],
    ['https://xxxxx.shoparena.pl', 'xxxxx.shoparena.pl'],
    ['HTTPS://xxxxx.shoparena.pl/', 'xxxxx.shoparena.pl'],
    ['sklep.example.com', 'sklep.example.com'],
  ])('should accept %p and normalise it to %p', (raw, host) => {
    expect(parseShoperBaseUrl(raw)).toEqual({ ok: true, host });
  });

  it.each([
    ['undefined', undefined],
    ['a number', 42],
    ['an empty string', ''],
    ['whitespace', '   '],
  ])('should reject %s as not a non-empty string', (_label, raw) => {
    expect(parseShoperBaseUrl(raw)).toEqual({
      ok: false,
      issues: [expect.stringContaining('non-empty string')],
    });
  });

  it.each([
    ['shop.internal'],
    ['shop.local'],
    ['shop.lan'],
    ['intranet.corp'],
    ['x.home.arpa'],
    ['shop.localhost'],
    ['shop.example'],
  ])('should reject the private or reserved suffix in %p', (raw) => {
    expect(parseShoperBaseUrl(raw)).toEqual({
      ok: false,
      issues: [expect.stringContaining('private or reserved')],
    });
  });

  it('should reject http because the token is sent on every request', () => {
    expect(parseShoperBaseUrl('http://xxxxx.shoparena.pl')).toEqual({
      ok: false,
      issues: [expect.stringContaining('https')],
    });
  });

  it.each([
    ['ftp://xxxxx.shoparena.pl'],
    ['xxxxx.shoparena.pl/webapi/rest'],
    ['https://xxxxx.shoparena.pl/admin'],
    ['xxxxx.shoparena.pl?x=1'],
    ['xxxxx.shoparena.pl#frag'],
    ['user:pw@xxxxx.shoparena.pl'],
    ['xxxxx.shoparena.pl:8443'],
  ])('should reject %p', (raw) => {
    expect(parseShoperBaseUrl(raw).ok).toBe(false);
  });

  it.each([
    ['127.0.0.1'],
    ['10.0.0.5'],
    ['169.254.169.254'],
    ['[::1]'],
    ['0x7f000001'],
    ['2130706433'],
    ['0177.0.0.1'],
    ['localhost'],
    ['shop'],
  ])('should reject the local or non-public host %p', (raw) => {
    expect(parseShoperBaseUrl(raw).ok).toBe(false);
  });

  it('should report every issue at once', () => {
    const result = parseShoperBaseUrl('user@xxxxx.shoparena.pl:81/path');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('buildShoperApiUrl', () => {
  it('should build an https URL under /webapi/rest', () => {
    expect(buildShoperApiUrl('xxxxx.shoparena.pl', '/application-config')).toBe(
      'https://xxxxx.shoparena.pl/webapi/rest/application-config'
    );
  });
});
