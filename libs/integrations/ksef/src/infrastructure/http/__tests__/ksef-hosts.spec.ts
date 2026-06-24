/**
 * KSeF host resolution specs.
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 */
import { resolveKsefBaseUrl } from '../ksef-hosts';
import { KsefConfigException } from '../../../domain/exceptions/ksef-config.exception';

describe('resolveKsefBaseUrl', () => {
  it('should resolve each known environment to its authoritative api.ksef host + /v2 base', () => {
    expect(resolveKsefBaseUrl('test')).toBe('https://api-test.ksef.mf.gov.pl/v2');
    expect(resolveKsefBaseUrl('demo')).toBe('https://api-demo.ksef.mf.gov.pl/v2');
    expect(resolveKsefBaseUrl('prod')).toBe('https://api.ksef.mf.gov.pl/v2');
  });

  it('should throw KsefConfigException for an unknown environment', () => {
    expect(() => resolveKsefBaseUrl('staging' as never)).toThrow(KsefConfigException);
  });
});
