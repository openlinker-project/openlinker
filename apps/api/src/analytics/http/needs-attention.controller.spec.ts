/**
 * Needs Attention Controller — Unit Tests (#1983)
 */
import type { NeedsAttentionSummary } from '../application/services/needs-attention.types';
import { NeedsAttentionController } from './needs-attention.controller';

describe('NeedsAttentionController', () => {
  it('should project the composed summary into the response DTO', async () => {
    const summary: NeedsAttentionSummary = {
      coverageGaps: [
        {
          variantId: 'v1',
          productId: 'p1',
          listedOnConnectionIds: ['conn-a'],
          missingFromConnectionIds: ['conn-b'],
        },
      ],
      coverageGapsTotalCount: 3,
      stockAtRisk: [
        { variantId: 'v2', productId: 'p2', connectionId: 'conn-a', masterStock: 0, stockSafetyBuffer: 5, stockZeroThreshold: 0 },
      ],
      stockAtRiskTotalCount: 6,
      failedSyncValue: {
        count: 2,
        totalValue: 500,
        mixedCurrency: false,
        oldestFailedAt: new Date('2026-08-01T00:00:00Z'),
      },
    };
    const service = { getSummary: jest.fn().mockResolvedValue(summary) };
    const controller = new NeedsAttentionController(service as never);

    const result = await controller.getNeedsAttention();

    expect(result.coverageGaps).toEqual(summary.coverageGaps);
    expect(result.coverageGapsTotalCount).toBe(3);
    expect(result.stockAtRisk).toEqual(summary.stockAtRisk);
    expect(result.stockAtRiskTotalCount).toBe(6);
    expect(result.failedSyncValue).toEqual({
      count: 2,
      totalValue: 500,
      mixedCurrency: false,
      oldestFailedAt: '2026-08-01T00:00:00.000Z',
    });
  });
});
