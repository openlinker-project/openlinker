/**
 * Analytics Matching Coverage Controller — Unit Tests (#2474)
 *
 * @module apps/api/src/analytics/http
 */
import { BadRequestException } from '@nestjs/common';
import type { IOrderRecordService } from '@openlinker/core/orders';
import { AnalyticsMatchingCoverageController } from './analytics-matching-coverage.controller';

describe('AnalyticsMatchingCoverageController (#2474)', () => {
  let orderRecordService: jest.Mocked<Pick<IOrderRecordService, 'getProductMatchingErrorOrders'>>;
  let controller: AnalyticsMatchingCoverageController;

  beforeEach(() => {
    orderRecordService = {
      getProductMatchingErrorOrders: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    };
    controller = new AnalyticsMatchingCoverageController(
      orderRecordService as unknown as IOrderRecordService
    );
  });

  const query = { from: '2026-08-01T00:00:00.000Z', to: '2026-08-27T00:00:00.000Z' };

  describe('getOrders', () => {
    it('should page the affected list and project each row', async () => {
      orderRecordService.getProductMatchingErrorOrders.mockResolvedValue({
        items: [
          {
            internalOrderId: 'ol_order_a',
            sourceConnectionId: 'conn-1',
            recordStatus: 'awaiting_mapping',
            mappingFailureReason: 'no barcode match',
            createdAt: new Date('2026-08-20T00:00:00Z'),
            productId: null,
          },
        ],
        total: 1,
      });

      const response = await controller.getOrders({ ...query, limit: 10, offset: 5 });

      expect(orderRecordService.getProductMatchingErrorOrders).toHaveBeenCalledWith(
        {
          sourceConnectionId: undefined,
          createdFrom: new Date(query.from),
          createdTo: new Date(query.to),
        },
        { limit: 10, offset: 5 }
      );
      expect(response.total).toBe(1);
      expect(response.items[0]).toMatchObject({
        internalOrderId: 'ol_order_a',
        recordStatus: 'awaiting_mapping',
        mappingFailureReason: 'no barcode match',
        productId: null,
      });
    });

    it('should default the page size when the caller omits pagination', async () => {
      await controller.getOrders(query);

      expect(orderRecordService.getProductMatchingErrorOrders).toHaveBeenCalledWith(
        expect.anything(),
        { limit: 25, offset: 0 }
      );
    });

    it('should narrow to a single source connection when supplied', async () => {
      await controller.getOrders({ ...query, sourceConnectionId: 'conn-9' });

      expect(orderRecordService.getProductMatchingErrorOrders).toHaveBeenCalledWith(
        expect.objectContaining({ sourceConnectionId: 'conn-9' }),
        expect.anything()
      );
    });

    it('should throw BadRequestException when to is not after from', async () => {
      await expect(
        controller.getOrders({ from: '2026-08-08T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' })
      ).rejects.toThrow(BadRequestException);
      expect(orderRecordService.getProductMatchingErrorOrders).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when the range exceeds the max window', async () => {
      await expect(
        controller.getOrders({ from: '2020-01-01T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z' })
      ).rejects.toThrow(BadRequestException);
      expect(orderRecordService.getProductMatchingErrorOrders).not.toHaveBeenCalled();
    });
  });
});
