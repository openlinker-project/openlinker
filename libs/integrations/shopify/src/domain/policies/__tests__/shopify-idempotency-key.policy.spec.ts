import { shopifyIdempotencyKey } from '../shopify-idempotency-key.policy';

describe('shopifyIdempotencyKey', () => {
  it('should give the same UUID-shaped key for the same connection, caller key and attempt', () => {
    const key = shopifyIdempotencyKey('c1', 'sale:owner:work:line', 1);

    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(shopifyIdempotencyKey('c1', 'sale:owner:work:line', 1)).toBe(key);
  });

  it('should give a different key per attempt and per connection', () => {
    const key = shopifyIdempotencyKey('c1', 'k', 1);

    expect(shopifyIdempotencyKey('c1', 'k', 2)).not.toBe(key);
    expect(shopifyIdempotencyKey('c2', 'k', 1)).not.toBe(key);
  });
});
