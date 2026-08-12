/**
 * Needs Attention Service — Unit Tests (#1983)
 */
import type { ICoverageGapReadService, IStockAtRiskReadService } from '@openlinker/core/listings';
import type { IOrderRecordService } from '@openlinker/core/orders';
import { NeedsAttentionService } from './needs-attention.service';

describe('NeedsAttentionService', () => {
  let coverageGapReadService: jest.Mocked<ICoverageGapReadService>;
  let stockAtRiskReadService: jest.Mocked<IStockAtRiskReadService>;
  let orderRecordService: jest.Mocked<Pick<IOrderRecordService, 'getFailedSyncValueSummary'>>;
  let service: NeedsAttentionService;

  beforeEach(() => {
    coverageGapReadService = { findCoverageGaps: jest.fn() };
    stockAtRiskReadService = { findStockAtRisk: jest.fn() };
    orderRecordService = { getFailedSyncValueSummary: jest.fn() };
    service = new NeedsAttentionService(
      coverageGapReadService,
      stockAtRiskReadService,
      orderRecordService as unknown as jest.Mocked<IOrderRecordService>
    );
  });

  it('should compose all three aggregates into one summary', async () => {
    const coverageGapItem = {
      variantId: 'v1',
      productId: 'p1',
      listedOnConnectionIds: ['conn-a'],
      missingFromConnectionIds: ['conn-b'],
    };
    const stockAtRiskItem = {
      variantId: 'v2',
      productId: 'p2',
      connectionId: 'conn-a',
      masterStock: 0,
      stockSafetyBuffer: 5,
    };
    const failedSyncValue = {
      count: 3,
      totalValue: 900,
      mixedCurrency: false,
      oldestFailedAt: new Date('2026-08-01T00:00:00Z'),
    };
    coverageGapReadService.findCoverageGaps.mockResolvedValue({
      items: [coverageGapItem],
      totalCount: 1,
    });
    stockAtRiskReadService.findStockAtRisk.mockResolvedValue({
      items: [stockAtRiskItem],
      totalCount: 1,
    });
    orderRecordService.getFailedSyncValueSummary.mockResolvedValue(failedSyncValue);

    const result = await service.getSummary();

    expect(result).toEqual({
      coverageGaps: [coverageGapItem],
      stockAtRisk: [stockAtRiskItem],
      failedSyncValue,
    });
    expect(orderRecordService.getFailedSyncValueSummary).toHaveBeenCalledWith({});
  });
});
