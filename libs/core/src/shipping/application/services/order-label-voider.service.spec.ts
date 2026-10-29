/**
 * Order Label Voider Service Tests (#3540, 4a)
 *
 * @module libs/core/src/shipping/application/services
 */
import { OrderLabelVoiderService } from './order-label-voider.service';

describe('OrderLabelVoiderService (#3540, 4a)', () => {
  const shipment = (id: string, status: string): unknown => ({ id, status });
  let query: { getOutboundByOrderId: jest.Mock };
  let cancellation: { cancel: jest.Mock };
  let service: OrderLabelVoiderService;

  beforeEach(() => {
    query = { getOutboundByOrderId: jest.fn() };
    cancellation = { cancel: jest.fn().mockResolvedValue(undefined) };
    service = new OrderLabelVoiderService(query as never, cancellation as never);
  });

  it('should void drafted and generated labels only when the order is cancelled (4a)', async () => {
    query.getOutboundByOrderId.mockResolvedValue([
      shipment('s1', 'draft'),
      shipment('s2', 'generated'),
      shipment('s3', 'dispatched'),
      shipment('s4', 'delivered'),
    ]);

    const outcomes = await service.voidLabelsForOrder('o1');

    expect(cancellation.cancel.mock.calls).toEqual([['s1'], ['s2']]);
    expect(outcomes).toEqual([
      { shipmentId: 's1', outcome: 'voided' },
      { shipmentId: 's2', outcome: 'voided' },
    ]);
  });

  it('should report a failed void and still try the next label (4a)', async () => {
    query.getOutboundByOrderId.mockResolvedValue([
      shipment('s1', 'generated'),
      shipment('s2', 'generated'),
    ]);
    cancellation.cancel.mockRejectedValueOnce(new Error('carrier refused'));

    const outcomes = await service.voidLabelsForOrder('o1');

    expect(outcomes).toEqual([
      { shipmentId: 's1', outcome: 'failed', detail: 'carrier refused' },
      { shipmentId: 's2', outcome: 'voided' },
    ]);
  });
});
