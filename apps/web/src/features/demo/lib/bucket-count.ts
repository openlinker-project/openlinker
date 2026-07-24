/**
 * Bucket Count
 *
 * Buckets a raw item count into a low-cardinality string for demo-mode
 * analytics props (e.g. `resultCountBucket`, `adapterCountBucket`,
 * `mappedCountBucket`). Shared across every "viewed" event that reports a
 * list/result size, rather than re-implementing the same four bands per
 * call site.
 *
 * @module features/demo/lib
 */

export function bucketCount(count: number): string {
  if (count === 0) return '0';
  if (count <= 10) return '1-10';
  if (count <= 50) return '11-50';
  return '50+';
}
