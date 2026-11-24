import { ShopifyGraphqlError } from '../../../domain/exceptions/shopify-graphql.error';
import { ShopifyBatchSizer } from '../shopify-cost-backoff';

const tooExpensive = new ShopifyGraphqlError(['MAX_COST_EXCEEDED'], ['Query cost is 1500, which exceeds the single query max cost limit (1000).']);

describe('ShopifyBatchSizer', () => {
  it('should halve the batch until Shopify accepts the cost, and keep the size that worked', async () => {
    const sizer = new ShopifyBatchSizer(10);
    const read = jest.fn((size: number) => (size > 2 ? Promise.reject(tooExpensive) : Promise.resolve(size)));

    await expect(sizer.run(read)).resolves.toBe(2);
    expect(read.mock.calls.map(([size]) => size)).toEqual([10, 5, 2]);
    expect(sizer.current).toBe(2);
  });

  it('should throw a cost refusal at size 1, since nothing smaller exists', async () => {
    const sizer = new ShopifyBatchSizer(1);

    await expect(sizer.run(() => Promise.reject(tooExpensive))).rejects.toBe(tooExpensive);
  });

  it('should not shrink on any other error', async () => {
    const sizer = new ShopifyBatchSizer(10);
    const throttled = new ShopifyGraphqlError(['THROTTLED'], ['Throttled']);

    await expect(sizer.run(() => Promise.reject(throttled))).rejects.toBe(throttled);
    expect(sizer.current).toBe(10);
  });
});
