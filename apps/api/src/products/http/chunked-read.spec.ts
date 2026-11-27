import { MAX_STOCK_VIEW_VARIANT_IDS } from '@openlinker/core/inventory';
import { chunkedRead } from './products.controller';

describe('chunkedRead (#3520)', () => {
  it('should split a long id list into capped chunks and join the results', async () => {
    const ids = Array.from({ length: MAX_STOCK_VIEW_VARIANT_IDS * 2 + 5 }, (_, i) => `v${String(i)}`);
    const read = jest.fn((chunk: string[]) => Promise.resolve(chunk));

    const result = await chunkedRead(ids, read);

    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls.every(([chunk]) => chunk.length <= MAX_STOCK_VIEW_VARIANT_IDS)).toBe(true);
    expect(result).toEqual(ids);
  });

  it('should not call the read for an empty list', async () => {
    const read = jest.fn();
    expect(await chunkedRead([], read)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});
