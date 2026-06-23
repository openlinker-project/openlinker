/**
 * KSeF host resolution specs.
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 */
import { resolveKsefBaseUrl } from '../ksef-hosts';
import { KsefConfigException } from '../../../domain/exceptions/ksef-config.exception';

describe('resolveKsefBaseUrl', () => {
  it('should resolve each known environment to a v2 base URL', () => {
    expect(resolveKsefBaseUrl('test')).toContain('/api/v2');
    expect(resolveKsefBaseUrl('demo')).toContain('/api/v2');
    expect(resolveKsefBaseUrl('prod')).toContain('/api/v2');
  });

  it('should throw KsefConfigException for an unknown environment', () => {
    expect(() => resolveKsefBaseUrl('staging' as never)).toThrow(KsefConfigException);
  });
});
