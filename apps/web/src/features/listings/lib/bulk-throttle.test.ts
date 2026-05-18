import { describe, expect, it } from 'vitest';
import { pAllLimit } from './bulk-throttle';

describe('pAllLimit', () => {
  it('returns results in input order', async () => {
    const results = await pAllLimit([1, 2, 3, 4, 5], 2, async (n) => n * 2);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([
      2, 4, 6, 8, 10,
    ]);
  });

  it('respects the concurrency limit', async () => {
    let inFlight = 0;
    let max = 0;
    await pAllLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      inFlight += 1;
      if (inFlight > max) max = inFlight;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1);
      });
      inFlight -= 1;
      return 'ok';
    });
    expect(max).toBeLessThanOrEqual(3);
  });

  it('captures rejections in a settled tuple', async () => {
    const results = await pAllLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });
    expect(results[0]!.status).toBe('fulfilled');
    expect(results[1]!.status).toBe('rejected');
    expect(results[2]!.status).toBe('fulfilled');
  });

  it('handles empty input', async () => {
    const results = await pAllLimit([], 4, async (n) => n);
    expect(results).toEqual([]);
  });

  it('throws when limit < 1', async () => {
    await expect(pAllLimit([1], 0, async (n) => n)).rejects.toThrow();
  });
});
