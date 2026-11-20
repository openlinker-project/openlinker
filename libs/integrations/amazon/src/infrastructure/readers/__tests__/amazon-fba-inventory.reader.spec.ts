/**
 * AmazonFbaInventoryReader tests (#4183)
 *
 * @module libs/integrations/amazon/src/infrastructure/readers/__tests__
 */
import type { AmazonSpApiClient } from '../../http/amazon-spapi-client';
import { AMAZON_FBA_SKUS_PER_CALL, AmazonFbaInventoryReader } from '../amazon-fba-inventory.reader';

const DE = 'A1PA6795UKMFR9';
const ok = (data: unknown): { status: number; requestId: string; data: unknown } => ({ status: 200, requestId: 'r', data });

describe('AmazonFbaInventoryReader', () => {
  it('should read fulfillable and reserved units at marketplace granularity', async () => {
    const get = jest.fn().mockResolvedValue(
      ok({
        payload: {
          inventorySummaries: [
            {
              sellerSku: 'MUG',
              inventoryDetails: { fulfillableQuantity: 5, reservedQuantity: { totalReservedQuantity: 2 } },
              lastUpdatedTime: '2026-11-18T10:00:00Z',
            },
          ],
        },
      }),
    );
    const reader = new AmazonFbaInventoryReader({ get } as unknown as AmazonSpApiClient, DE);

    const stock = await reader.read(['MUG', 'CUP']);

    expect(get).toHaveBeenCalledWith('/fba/inventory/v1/summaries', {
      details: 'true',
      granularityType: 'Marketplace',
      granularityId: DE,
      marketplaceIds: [DE],
      sellerSkus: ['MUG', 'CUP'],
    });
    expect(stock.get('MUG')).toEqual({ fulfillable: 5, reserved: 2, updatedAt: new Date('2026-11-18T10:00:00Z') });
    expect(stock.get('CUP')).toEqual({ fulfillable: 0, reserved: 0, updatedAt: null });
  });

  it('should ask for at most 50 SKUs a call and cache the answers', async () => {
    const get = jest.fn().mockResolvedValue(ok({ payload: { inventorySummaries: [] } }));
    const reader = new AmazonFbaInventoryReader({ get } as unknown as AmazonSpApiClient, DE);
    const skus = Array.from({ length: AMAZON_FBA_SKUS_PER_CALL + 1 }, (_, i) => `SKU-${i}`);

    await reader.read(skus);
    await reader.read(skus);

    expect(get).toHaveBeenCalledTimes(2);
  });

  it('should follow the next token', async () => {
    const get = jest
      .fn()
      .mockResolvedValueOnce(ok({ payload: { inventorySummaries: [] }, pagination: { nextToken: 't1' } }))
      .mockResolvedValueOnce(
        ok({ payload: { inventorySummaries: [{ sellerSku: 'MUG', inventoryDetails: { fulfillableQuantity: 3 } }] } }),
      );
    const reader = new AmazonFbaInventoryReader({ get } as unknown as AmazonSpApiClient, DE);

    const stock = await reader.read(['MUG']);

    expect((get.mock.calls as unknown[][])[1][1]).toEqual(expect.objectContaining({ nextToken: 't1' }));
    expect(stock.get('MUG')?.fulfillable).toBe(3);
  });
});
