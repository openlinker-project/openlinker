/**
 * PrestaShop Order Processor Manager — OrderStatusWriteback (#1158 / ADR-027)
 *
 * The event-as-data writeback the lifecycle relay dispatches through. Delegates
 * to `updateFulfillment` internals; refuses a cancel when the shop already
 * shipped/delivered (reports `rejected`, never throws).
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import {
  createOrderProcessorManagerHarness,
  type OrderProcessorHarness,
} from '../../../__tests__/mocks/prestashop-order-processor-manager.factory';

const STATE_ID: Record<string, number> = { shipped: 4, delivered: 5, cancelled: 6 };

describe('PrestashopOrderProcessorManagerAdapter — OrderStatusWriteback.write', () => {
  let adapter: OrderProcessorHarness['adapter'];
  let mockHttpClient: OrderProcessorHarness['mockHttpClient'];
  let mockOrderMapper: OrderProcessorHarness['mockOrderMapper'];

  const PS_ORDER_ID = '5001';

  beforeEach(() => {
    ({ adapter, mockHttpClient, mockOrderMapper } = createOrderProcessorManagerHarness());
    mockOrderMapper.mapStatusToPrestashopStateId = jest
      .fn()
      .mockImplementation((status: string) => STATE_ID[status] ?? 0);
  });

  describe('dispatched', () => {
    it('transitions to the shipped state and returns applied', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '2', id_carrier: 7 });

      const result = await adapter.write({ type: 'dispatched', externalOrderId: PS_ORDER_ID });

      expect(result).toEqual({ outcome: 'applied' });
      expect(mockHttpClient.createResource).toHaveBeenCalledWith(
        'order_histories',
        { id_order: PS_ORDER_ID, id_order_state: STATE_ID.shipped },
        { sendEmail: true }
      );
    });

    it('returns rejected (not thrown) when the WebService call fails', async () => {
      mockHttpClient.getResource = jest.fn().mockRejectedValue(new Error('WS 500'));

      const result = await adapter.write({ type: 'dispatched', externalOrderId: PS_ORDER_ID });

      expect(result.outcome).toBe('rejected');
      expect(result.detail).toContain('WS 500');
    });
  });

  describe('cancelled', () => {
    it('transitions to the cancelled state when the order has not shipped', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '2', id_carrier: 7 });

      const result = await adapter.write({ type: 'cancelled', externalOrderId: PS_ORDER_ID });

      expect(result).toEqual({ outcome: 'applied' });
      expect(mockHttpClient.createResource).toHaveBeenCalledWith(
        'order_histories',
        { id_order: PS_ORDER_ID, id_order_state: STATE_ID.cancelled },
        { sendEmail: true }
      );
    });

    it('refuses to cancel an already-shipped order (rejected, no state write)', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '4', id_carrier: 7 });

      const result = await adapter.write({ type: 'cancelled', externalOrderId: PS_ORDER_ID });

      expect(result.outcome).toBe('rejected');
      expect(result.detail).toContain('already shipped');
      expect(mockHttpClient.createResource).not.toHaveBeenCalledWith(
        'order_histories',
        expect.anything(),
        expect.anything()
      );
    });

    it('refuses to cancel an already-delivered order (rejected)', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '5', id_carrier: 7 });

      const result = await adapter.write({ type: 'cancelled', externalOrderId: PS_ORDER_ID });

      expect(result.outcome).toBe('rejected');
      expect(mockHttpClient.createResource).not.toHaveBeenCalledWith(
        'order_histories',
        expect.anything(),
        expect.anything()
      );
    });
  });
});
