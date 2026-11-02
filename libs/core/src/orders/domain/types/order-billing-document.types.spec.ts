/**
 * isShareableBillingDocumentUrl tests (#3549)
 */
import { isShareableBillingDocumentUrl } from './order-billing-document.types';

describe('isShareableBillingDocumentUrl', () => {
  it.each([
    'https://ksef.mf.gov.pl/client-app/invoice/abc',
    'https://eparagony.pl/r/123?x=1',
    'https://docs.provider.com:8443/inv.pdf',
  ])('should accept a public https link: %s', (url) => {
    expect(isShareableBillingDocumentUrl(url)).toBe(true);
  });

  it.each([
    ['plain http', 'http://eparagony.pl/r/123'],
    ['a private address', 'https://192.168.1.10/invoice.pdf'],
    ['an IPv6 literal', 'https://[::1]/invoice.pdf'],
    ['localhost', 'https://localhost/invoice.pdf'],
    ['a single-label host', 'https://subiekt-bridge/invoice.pdf'],
    ['a local suffix', 'https://bridge.local/invoice.pdf'],
    ['an internal suffix', 'https://docs.corp.internal/invoice.pdf'],
    ['embedded credentials', 'https://user:pass@eparagony.pl/r/1'],
    ['another scheme', 'ftp://eparagony.pl/r/1'],
    ['not a url', 'not a url'],
  ])('should refuse %s', (_label, url) => {
    expect(isShareableBillingDocumentUrl(url)).toBe(false);
  });
});
