/**
 * PrestaShop Order Processor Manager — getFulfillmentStatus (#834)
 *
 * FulfillmentStatusReader capability. Split from the former 2279-line adapter
 * spec (#976); shared mocks/adapter/builders live in the sibling factory at
 * src/__tests__/mocks.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import {
  createOrderProcessorManagerHarness,
  OL_DYNAMIC_CARRIER_ID,
  type OrderProcessorHarness,
} from '../../../__tests__/mocks/prestashop-order-processor-manager.factory';
import { PrestashopResourceNotFoundException } from '@openlinker/integrations-prestashop';
import type { PrestashopOrder } from '../../mappers/prestashop.mapper.interface';

describe('PrestashopOrderProcessorManagerAdapter — getFulfillmentStatus', () => {
  let adapter: OrderProcessorHarness['adapter'];
  let mockHttpClient: OrderProcessorHarness['mockHttpClient'];

  beforeEach(() => {
    ({ adapter, mockHttpClient } = createOrderProcessorManagerHarness());
  });

  describe('getFulfillmentStatus (#834 — FulfillmentStatusReader)', () => {
    const PS_ORDER_ID = '5001';

    /**
     * Stub PS `getResource`/`listResources` paths needed by the
     * fulfillment-status read. The state map is loaded lazily on the first
     * `getFulfillmentStatus` call; subsequent calls reuse the cache, so the
     * `order_states` listResources call should fire exactly **once** per
     * adapter instance. Verified explicitly in the dedicated cache test.
     */
    beforeEach(() => {
      mockHttpClient.getResource = jest.fn().mockImplementation(
        (resource: string, _id: string | number) => {
          if (resource === 'orders') {
            return Promise.resolve({
              id: PS_ORDER_ID,
              current_state: '5',
              date_upd: '2026-05-28 14:00:00',
              shipping_number: 'PS-TRK-1',
            } as PrestashopOrder);
          }
          return Promise.resolve(null);
        }
      );
      // Keep the carrier-mapping path from the parent beforeEach intact,
      // add the order_states + order_carriers branches.
      mockHttpClient.listResources = jest
        .fn()
        .mockImplementation((resource: string, params?: { custom?: Record<string, unknown> }) => {
          if (resource === 'carriers' && params?.custom?.external_module_name === 'openlinker') {
            return Promise.resolve([{ id: OL_DYNAMIC_CARRIER_ID, active: '1', deleted: '0' }]);
          }
          if (resource === 'order_states') {
            return Promise.resolve([
              { id: '4', name: 'Awaiting payment', deleted: '0' },
              { id: '5', name: 'Shipped', deleted: '0', shipped: '1' },
              { id: '6', name: 'Delivered', deleted: '0', delivered: '1', shipped: '1' },
              { id: '7', name: 'Cancelled', deleted: '0' },
            ]);
          }
          if (resource === 'order_carriers') {
            return Promise.resolve([]);
          }
          return Promise.resolve([]);
        });
    });

    it('should project PS state.shipped=1 onto FulfillmentStatus.Dispatched with tracking', async () => {
      const snapshot = await adapter.getFulfillmentStatus({ externalOrderId: PS_ORDER_ID });

      expect(snapshot.status).toBe('dispatched');
      expect(snapshot.trackingNumber).toBe('PS-TRK-1');
      expect(snapshot.deliveredAt).toBeNull();
    });

    it('should cache the order_states map across calls (one listResources(order_states) per adapter instance)', async () => {
      await adapter.getFulfillmentStatus({ externalOrderId: PS_ORDER_ID });
      await adapter.getFulfillmentStatus({ externalOrderId: PS_ORDER_ID });
      await adapter.getFulfillmentStatus({ externalOrderId: PS_ORDER_ID });

      const orderStatesCalls = (mockHttpClient.listResources as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[0] === 'order_states'
      );
      expect(orderStatesCalls).toHaveLength(1);
    });

    it('should NOT fetch order_carriers when order.shipping_number is set (lazy WS optimisation)', async () => {
      // The default `beforeEach` returns an order with `shipping_number: 'PS-TRK-1'`,
      // so the carriers fetch should be skipped entirely.
      await adapter.getFulfillmentStatus({ externalOrderId: PS_ORDER_ID });
      await adapter.getFulfillmentStatus({ externalOrderId: PS_ORDER_ID });

      const orderCarriersCalls = (mockHttpClient.listResources as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[0] === 'order_carriers'
      );
      expect(orderCarriersCalls).toHaveLength(0);
    });

    it('should fetch order_carriers as fallback when shipping_number is empty', async () => {
      // Re-stub `getResource` so the order has NO shipping_number.
      mockHttpClient.getResource = jest.fn().mockResolvedValue({
        id: PS_ORDER_ID,
        current_state: '5',
        date_upd: '2026-05-28 14:00:00',
        // no shipping_number
      } as PrestashopOrder);
      // Carriers row with tracking — the mapper should pick it up.
      (mockHttpClient.listResources as jest.Mock).mockImplementation(
        (resource: string, params?: { custom?: Record<string, unknown> }) => {
          if (resource === 'carriers' && params?.custom?.external_module_name === 'openlinker') {
            return Promise.resolve([{ id: OL_DYNAMIC_CARRIER_ID, active: '1', deleted: '0' }]);
          }
          if (resource === 'order_states') {
            return Promise.resolve([
              { id: '5', name: 'Shipped', deleted: '0', shipped: '1' },
            ]);
          }
          if (resource === 'order_carriers') {
            return Promise.resolve([
              { id: '10', id_order: PS_ORDER_ID, id_carrier: '1', tracking_number: 'CARR-TRK-9' },
            ]);
          }
          return Promise.resolve([]);
        },
      );

      const snapshot = await adapter.getFulfillmentStatus({ externalOrderId: PS_ORDER_ID });

      expect(snapshot.trackingNumber).toBe('CARR-TRK-9');
      const orderCarriersCalls = (mockHttpClient.listResources as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[0] === 'order_carriers'
      );
      expect(orderCarriersCalls).toHaveLength(1);
    });

    it('should issue WS calls with the documented resource shapes', async () => {
      await adapter.getFulfillmentStatus({ externalOrderId: PS_ORDER_ID });

      expect(mockHttpClient.getResource).toHaveBeenCalledWith('orders', PS_ORDER_ID);
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'order_states',
        { custom: { deleted: '0' } },
        1000,
        0
      );
      // order_carriers is NOT called here — shipping_number was set on the order.
    });

    it('should swallow PrestashopResourceNotFoundException as `{status: null}` (order deleted in PS)', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockRejectedValue(new PrestashopResourceNotFoundException('orders', PS_ORDER_ID));

      const snapshot = await adapter.getFulfillmentStatus({ externalOrderId: PS_ORDER_ID });

      expect(snapshot.status).toBeNull();
      expect(snapshot.trackingNumber).toBeNull();
      expect(snapshot.deliveredAt).toBeNull();
    });
  });
});
