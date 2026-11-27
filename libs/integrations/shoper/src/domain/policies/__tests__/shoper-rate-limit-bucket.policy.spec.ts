/**
 * Shoper Rate-Limit Bucket Policy Unit Tests
 *
 * @module libs/integrations/shoper/src/domain/policies/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';

import {
  buildShoperRateLimitBucketKey,
  resolveShoperRateLimitBucketKey,
} from '../shoper-rate-limit-bucket.policy';

function connection(baseUrl: unknown): Pick<Connection, 'id' | 'config'> {
  return { id: 'conn-1', config: { baseUrl } } as unknown as Pick<Connection, 'id' | 'config'>;
}

describe('Shoper rate-limit bucket policy', () => {
  it('should key the bucket by the shop host when the baseUrl is valid', () => {
    expect(resolveShoperRateLimitBucketKey(connection('sklep1.shoparena.pl'))).toBe(
      'shoper:host:sklep1.shoparena.pl',
    );
  });

  it.each([
    ['SKLEP1.shoparena.pl'],
    ['https://sklep1.shoparena.pl'],
    ['  https://Sklep1.Shoparena.PL  '],
  ])('should normalise %p to the same shop bucket when it differs only in case, scheme or whitespace', (baseUrl) => {
    expect(resolveShoperRateLimitBucketKey(connection(baseUrl))).toBe(
      buildShoperRateLimitBucketKey('sklep1.shoparena.pl'),
    );
  });

  it('should keep two shops apart when their hosts differ', () => {
    expect(resolveShoperRateLimitBucketKey(connection('sklep1.shoparena.pl'))).not.toBe(
      resolveShoperRateLimitBucketKey(connection('sklep2.shoparena.pl')),
    );
  });

  it.each([[undefined], [''], ['localhost'], ['10.0.0.1']])(
    'should answer undefined, the connection bucket, when the baseUrl %p is unusable',
    (baseUrl) => {
      expect(resolveShoperRateLimitBucketKey(connection(baseUrl))).toBeUndefined();
    },
  );

  it('should answer undefined when the connection carries no config at all', () => {
    expect(
      resolveShoperRateLimitBucketKey({ id: 'conn-1' } as unknown as Pick<Connection, 'id' | 'config'>),
    ).toBeUndefined();
  });
});
