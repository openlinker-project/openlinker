/**
 * Return Bucket Types — unit spec (#2332)
 *
 * @module domain/types
 */
import { ReturnBucketValues, isReturnBucket } from './return-bucket.types';

describe('isReturnBucket', () => {
  it.each(ReturnBucketValues)('should accept the declared bucket %s', (value) => {
    expect(isReturnBucket(value)).toBe(true);
  });

  it.each(['', 'ORPHAN', 'unattributed', 'all'])(
    'should reject %p rather than defaulting to a member',
    (value) => {
      // A bucket filter that silently falls back shows an operator a list they did not
      // ask for.
      expect(isReturnBucket(value)).toBe(false);
    }
  );
});
