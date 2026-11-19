/**
 * AmazonListingReader tests (#4182)
 *
 * @module libs/integrations/amazon/src/infrastructure/readers/__tests__
 */
import { InMemoryCacheAdapter } from '@openlinker/shared/cache/testing';

import { AmazonApiError } from '../../../domain/exceptions/amazon-api.error';
import type { AmazonSpApiClient } from '../../http/amazon-spapi-client';
import { AmazonListingReader } from '../amazon-listing.reader';

const DE = 'A1PA6795UKMFR9';

function setup(withCache = true): { reader: AmazonListingReader; get: jest.Mock } {
  const get = jest.fn();
  const reader = new AmazonListingReader(
    { get } as unknown as AmazonSpApiClient,
    'A2SELLER123',
    DE,
    'conn-amz',
    withCache ? new InMemoryCacheAdapter() : undefined,
  );
  return { reader, get };
}

const page = (skus: string[], nextToken?: string) => ({
  status: 200,
  requestId: 'r',
  data: { numberOfResults: skus.length, items: skus.map((sku) => ({ sku })), pagination: nextToken ? { nextToken } : {} },
});

describe('AmazonListingReader', () => {
  it('should prefetch 20 SKUs per call and report a missing SKU as absent without another call', async () => {
    const { reader, get } = setup();
    get.mockResolvedValue(page(['A']));

    await reader.prefetch(['A', 'B']);

    expect(get).toHaveBeenCalledTimes(1);
    expect((get.mock.calls as unknown[][])[0][1]).toMatchObject({ identifiers: ['A', 'B'], identifiersType: 'SKU' });
    await expect(reader.read('A')).resolves.toEqual({ sku: 'A' });
    await expect(reader.read('B')).resolves.toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('should answer null for a listing Amazon does not have', async () => {
    const { reader, get } = setup();
    get.mockRejectedValue(new AmazonApiError(404, 'NOT_FOUND', 'gone', 'r'));

    await expect(reader.read('GONE')).resolves.toBeNull();
  });

  it('should remember page tokens so a later page costs one call', async () => {
    const { reader, get } = setup();
    get.mockResolvedValueOnce(page(['A', 'B'], 't1')).mockResolvedValueOnce(page(['C'], 't2'));

    await expect(reader.page(1)).resolves.toEqual([{ sku: 'C' }]);
    expect(get).toHaveBeenCalledTimes(2);

    get.mockResolvedValueOnce(page(['C'], 't2'));
    await reader.page(1);
    expect(get).toHaveBeenCalledTimes(3);
    expect((get.mock.calls as unknown[][])[2][1]).toMatchObject({ pageToken: 't1' });
  });

  it('should report no page past the last one', async () => {
    const { reader, get } = setup();
    get.mockResolvedValueOnce(page(['A']));

    await expect(reader.page(0)).resolves.toEqual([{ sku: 'A' }]);
    await expect(reader.page(1)).resolves.toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });
});
