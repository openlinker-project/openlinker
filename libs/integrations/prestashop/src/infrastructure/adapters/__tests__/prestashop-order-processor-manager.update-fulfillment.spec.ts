/**
 * PrestaShop Order Processor Manager — updateFulfillment (#858)
 *
 * Split from the former 2279-line adapter spec (#976); shared
 * mocks/adapter/builders live in the sibling factory at src/__tests__/mocks.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import {
  createOrderProcessorManagerHarness,
  type OrderProcessorHarness,
} from '../../../__tests__/mocks/prestashop-order-processor-manager.factory';
import { PrestashopApiException } from '@openlinker/integrations-prestashop';

describe('PrestashopOrderProcessorManagerAdapter — updateFulfillment', () => {
  let adapter: OrderProcessorHarness['adapter'];
  let mockHttpClient: OrderProcessorHarness['mockHttpClient'];
  let mockOrderMapper: OrderProcessorHarness['mockOrderMapper'];

  beforeEach(() => {
    ({ adapter, mockHttpClient, mockOrderMapper } = createOrderProcessorManagerHarness());
  });

  describe('updateFulfillment (#858)', () => {
    const PS_ORDER_ID = '5001';
    const SHIPPED_STATE_ID = 4;

    beforeEach(() => {
      mockOrderMapper.mapStatusToPrestashopStateId = jest.fn().mockReturnValue(SHIPPED_STATE_ID);
    });

    it('should transition state via POST order_histories with sendmail when not in the target state', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '2', id_carrier: 7 });

      await adapter.updateFulfillment({ externalOrderId: PS_ORDER_ID, status: 'shipped' });

      expect(mockOrderMapper.mapStatusToPrestashopStateId).toHaveBeenCalledWith('shipped');
      // sendmail=1 (the buyer "shipped" email) is requested via the typed option.
      expect(mockHttpClient.createResource).toHaveBeenCalledWith(
        'order_histories',
        { id_order: PS_ORDER_ID, id_order_state: SHIPPED_STATE_ID },
        { sendEmail: true }
      );
    });

    it('should skip the order_histories POST when already in the target state (idempotent)', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '4', id_carrier: 7 });

      await adapter.updateFulfillment({ externalOrderId: PS_ORDER_ID, status: 'shipped' });

      // No order_histories POST at all (covers both the 3-arg and a future 2-arg shape).
      expect(mockHttpClient.createResource).not.toHaveBeenCalledWith(
        'order_histories',
        expect.anything()
      );
      expect(mockHttpClient.createResource).not.toHaveBeenCalledWith(
        'order_histories',
        expect.anything(),
        expect.anything()
      );
    });

    it('should write tracking BEFORE transitioning state (irreversible email last)', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '2', id_carrier: 7 });
      mockHttpClient.listResources = jest
        .fn()
        .mockImplementation((resource: string) =>
          resource === 'order_carriers'
            ? Promise.resolve([
                { id: '900', id_order: PS_ORDER_ID, id_carrier: 7, tracking_number: '' },
              ])
            : Promise.resolve([])
        );

      await adapter.updateFulfillment({
        externalOrderId: PS_ORDER_ID,
        status: 'shipped',
        trackingNumber: 'TRACK-9',
      });

      // Tracking (updateResource on order_carriers) must precede the
      // order_histories POST, so the shipped email renders the tracking link.
      const trackingOrder = mockHttpClient.updateResource.mock.invocationCallOrder[0];
      const historyOrder = mockHttpClient.createResource.mock.invocationCallOrder[0];
      expect(trackingOrder).toBeLessThan(historyOrder);
    });

    it('should write tracking by full-replacing the existing order_carriers row', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '4', id_carrier: 7 });
      const carrierRow = {
        id: '900',
        id_order: PS_ORDER_ID,
        id_carrier: 7,
        weight: '1.2',
        tracking_number: '',
      };
      mockHttpClient.listResources = jest
        .fn()
        .mockImplementation((resource: string) =>
          resource === 'order_carriers' ? Promise.resolve([carrierRow]) : Promise.resolve([])
        );

      await adapter.updateFulfillment({
        externalOrderId: PS_ORDER_ID,
        status: 'shipped',
        trackingNumber: 'TRACK-9',
      });

      expect(mockHttpClient.updateResource).toHaveBeenCalledWith('order_carriers', '900', {
        ...carrierRow,
        tracking_number: 'TRACK-9',
      });
    });

    it('should write tracking to the max-id order_carriers row when several exist (re-ship)', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '4', id_carrier: 7 });
      mockHttpClient.listResources = jest
        .fn()
        .mockImplementation((resource: string) =>
          resource === 'order_carriers'
            ? Promise.resolve([
                { id: '900', id_order: PS_ORDER_ID, id_carrier: 7, tracking_number: '' },
                { id: '905', id_order: PS_ORDER_ID, id_carrier: 9, tracking_number: '' },
              ])
            : Promise.resolve([])
        );

      await adapter.updateFulfillment({
        externalOrderId: PS_ORDER_ID,
        status: 'shipped',
        trackingNumber: 'TRACK-9',
      });

      // The current carrier is the highest id (905), not rows[0] (900).
      expect(mockHttpClient.updateResource).toHaveBeenCalledWith(
        'order_carriers',
        '905',
        expect.objectContaining({ tracking_number: 'TRACK-9' })
      );
    });

    it('should warn and skip (not fabricate) when no order_carriers row exists', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '4', id_carrier: 7 });
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);

      await adapter.updateFulfillment({
        externalOrderId: PS_ORDER_ID,
        status: 'shipped',
        trackingNumber: 'TRACK-9',
      });

      // No fabrication: neither a PUT nor a POST to order_carriers.
      expect(mockHttpClient.updateResource).not.toHaveBeenCalled();
      expect(mockHttpClient.createResource).not.toHaveBeenCalledWith(
        'order_carriers',
        expect.anything(),
        expect.anything()
      );
    });

    it('should skip the tracking write when the value is unchanged (idempotent)', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '4', id_carrier: 7 });
      mockHttpClient.listResources = jest
        .fn()
        .mockImplementation((resource: string) =>
          resource === 'order_carriers'
            ? Promise.resolve([
                { id: '900', id_order: PS_ORDER_ID, id_carrier: 7, tracking_number: 'TRACK-9' },
              ])
            : Promise.resolve([])
        );

      await adapter.updateFulfillment({
        externalOrderId: PS_ORDER_ID,
        status: 'shipped',
        trackingNumber: 'TRACK-9',
      });

      expect(mockHttpClient.updateResource).not.toHaveBeenCalled();
    });

    it('should not touch order_carriers when no trackingNumber is supplied', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '2', id_carrier: 7 });

      await adapter.updateFulfillment({ externalOrderId: PS_ORDER_ID, status: 'shipped' });

      expect(mockHttpClient.listResources).not.toHaveBeenCalledWith(
        'order_carriers',
        expect.anything()
      );
      expect(mockHttpClient.updateResource).not.toHaveBeenCalled();
    });

    it('should wrap a WebService failure in PrestashopApiException', async () => {
      mockHttpClient.getResource = jest.fn().mockRejectedValue(new Error('WS 500'));

      await expect(
        adapter.updateFulfillment({ externalOrderId: PS_ORDER_ID, status: 'shipped' })
      ).rejects.toBeInstanceOf(PrestashopApiException);
    });
  });
});
