import { estimateAvailablePoints, throttleWaitMs } from '../shopify-throttle.policy';

const observation = {
  status: { maximumAvailable: 20000, currentlyAvailable: 100, restoreRate: 1000 },
  lastQueryCost: 600,
  observedAtMs: 1_000,
};

describe('Shopify throttle policy', () => {
  it('should refill the bucket at the restore rate up to its maximum', () => {
    expect(estimateAvailablePoints(observation, 1_500)).toBe(600);
    expect(estimateAvailablePoints(observation, 1_000_000)).toBe(20000);
  });

  it('should wait until the bucket holds the cost, with slack', () => {
    expect(throttleWaitMs(observation, 600, 1_000)).toBe(750);
  });

  it('should not wait when the bucket already holds the cost', () => {
    expect(throttleWaitMs(observation, 600, 2_000)).toBe(0);
  });

  it('should not wait forever when Shopify reports no restore rate', () => {
    const stuck = { ...observation, status: { ...observation.status, restoreRate: 0 } };
    expect(throttleWaitMs(stuck, 600, 1_000)).toBe(0);
  });
});
