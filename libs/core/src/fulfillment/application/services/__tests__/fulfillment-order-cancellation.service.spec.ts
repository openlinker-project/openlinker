/**
 * Fulfillment Order Cancellation Service Tests (#3540)
 *
 * @module libs/core/src/fulfillment/application/services/__tests__
 */
import type { FulfillmentWorkRepositoryPort } from '../../../domain/ports/fulfillment-work-repository.port';
import { FulfillmentOrderCancellationService } from '../fulfillment-order-cancellation.service';

function work(id: string, status: string, requestStatus = 'unsubmitted'): unknown {
  return { id, status, requestStatus, assignedConnectionId: 'holder' };
}

describe('FulfillmentOrderCancellationService (#3540)', () => {
  let works: jest.Mocked<Pick<FulfillmentWorkRepositoryPort, 'findByOrderId' | 'cancel'>>;
  let service: FulfillmentOrderCancellationService;
  const at = new Date('2026-09-30T10:00:00.000Z');

  beforeEach(() => {
    works = { findByOrderId: jest.fn(), cancel: jest.fn() };
    service = new FulfillmentOrderCancellationService(works as unknown as FulfillmentWorkRepositoryPort);
  });

  describe('summarizeForOrder', () => {
    it('should project only the fields an order-level decision needs', async () => {
      works.findByOrderId.mockResolvedValue([work('w1', 'in_progress', 'accepted')] as never);

      expect(await service.summarizeForOrder('o1')).toEqual([
        { workId: 'w1', status: 'in_progress', requestStatus: 'accepted', assignedConnectionId: 'holder' },
      ]);
    });

    it('should return an empty list for an unrouted order', async () => {
      works.findByOrderId.mockResolvedValue([]);

      expect(await service.summarizeForOrder('o1')).toEqual([]);
    });
  });

  describe('cancelAllForOrder', () => {
    it('should cancel every non-terminal work with the order_cancelled reason', async () => {
      works.findByOrderId.mockResolvedValue([work('w1', 'open'), work('w2', 'in_progress')] as never);
      works.cancel.mockResolvedValue(true);

      const result = await service.cancelAllForOrder('o1', at);

      expect(works.cancel).toHaveBeenCalledWith({ workId: 'w1', reason: 'order_cancelled', cancelledAt: at });
      expect(works.cancel).toHaveBeenCalledWith({ workId: 'w2', reason: 'order_cancelled', cancelledAt: at });
      expect(result).toEqual({ cancelledWorkIds: ['w1', 'w2'], skippedWorkIds: [] });
    });

    it('should skip works that have already come to rest without re-stamping them', async () => {
      works.findByOrderId.mockResolvedValue([
        work('w1', 'closed'),
        work('w2', 'cancelled'),
        work('w3', 'incomplete'),
      ] as never);

      const result = await service.cancelAllForOrder('o1', at);

      expect(works.cancel).not.toHaveBeenCalled();
      expect(result.skippedWorkIds).toEqual(['w1', 'w2', 'w3']);
    });

    it('should report a work a peer moved first as skipped, not cancelled', async () => {
      works.findByOrderId.mockResolvedValue([work('w1', 'open')] as never);
      works.cancel.mockResolvedValue(false);

      const result = await service.cancelAllForOrder('o1', at);

      expect(result).toEqual({ cancelledWorkIds: [], skippedWorkIds: ['w1'] });
    });

    it('should be a no-op for an order with no work', async () => {
      works.findByOrderId.mockResolvedValue([]);

      expect(await service.cancelAllForOrder('o1', at)).toEqual({
        cancelledWorkIds: [],
        skippedWorkIds: [],
      });
    });
  });
});
