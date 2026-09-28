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
import type { OrderLifecycleEvent } from '@openlinker/core/orders';

const STATE_ID: Record<string, number> = { shipped: 4, delivered: 5, cancelled: 6 };

/**
 * An UNAMBIGUOUS state catalogue for the #3526 `delivered` / `in-progress`
 * tests — one row per flag combination, unlike `DEFAULT_INSTALL_ORDER_STATES`
 * (used by every other describe block above), whose ids 2 and 3 both carry
 * `paid=1, shipped=0, delivered=0` and would leave `'processing'` derivation
 * ambiguous. Mirrors `order-state-mapping.spec.ts`'s `CUSTOM_STATES` shape.
 */
const UNAMBIGUOUS_STATES: ReadonlyArray<Record<string, unknown>> = [
  { id: '30', name: 'New', deleted: '0', paid: '0', shipped: '0', delivered: '0' },
  { id: '31', name: 'Processing', deleted: '0', paid: '1', shipped: '0', delivered: '0' },
  { id: '32', name: 'Shipped', deleted: '0', paid: '1', shipped: '1', delivered: '0' },
  { id: '33', name: 'Delivered', deleted: '0', paid: '1', shipped: '1', delivered: '1' },
  { id: '34', name: 'Cancelled', deleted: '0', paid: '0', shipped: '0', delivered: '0' },
];

function serveStates(
  mockHttpClient: OrderProcessorHarness['mockHttpClient'],
  rows: ReadonlyArray<Record<string, unknown>>
): void {
  mockHttpClient.listResources = jest
    .fn()
    .mockImplementation((resource: string) =>
      Promise.resolve(resource === 'order_states' ? [...rows] : [])
    ) as typeof mockHttpClient.listResources;
}

describe('PrestashopOrderProcessorManagerAdapter — OrderStatusWriteback.write', () => {
  let adapter: OrderProcessorHarness['adapter'];
  let mockHttpClient: OrderProcessorHarness['mockHttpClient'];

  const PS_ORDER_ID = '5001';

  beforeEach(() => {
    ({ adapter, mockHttpClient } = createOrderProcessorManagerHarness());
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

  // #3526 — `delivered` and `in-progress` map onto PrestaShop's own native
  // `OrderStatus` vocabulary through the SAME `order_state_mappings` +
  // shop-catalogue-derivation seam `dispatched`/`cancelled` already use.
  describe('delivered (#3526)', () => {
    it('transitions to the delivered state and returns applied', async () => {
      serveStates(mockHttpClient, UNAMBIGUOUS_STATES);
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '32', id_carrier: 7 });

      const result = await adapter.write({ type: 'delivered', externalOrderId: PS_ORDER_ID });

      expect(result).toEqual({ outcome: 'applied' });
      expect(mockHttpClient.createResource).toHaveBeenCalledWith(
        'order_histories',
        { id_order: PS_ORDER_ID, id_order_state: 33 },
        { sendEmail: true }
      );
    });

    it('returns rejected — not unsupported — when the shop has no state for it', async () => {
      // Every state below is unambiguously something ELSE, so the shop
      // genuinely has no candidate for 'delivered'. This is an
      // OPERATOR-ACTIONABLE configuration gap (map a state), not a
      // structural incapability — `rejected`, matching `dispatched`'s own
      // unresolved-mapping behaviour, never `unsupported`.
      serveStates(mockHttpClient, [
        { id: '1', name: 'New', deleted: '0', paid: '0', shipped: '0', delivered: '0' },
      ]);
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '1' });

      const result = await adapter.write({ type: 'delivered', externalOrderId: PS_ORDER_ID });

      expect(result.outcome).toBe('rejected');
    });
  });

  describe('in-progress (#3526)', () => {
    it('transitions to the processing state and returns applied', async () => {
      serveStates(mockHttpClient, UNAMBIGUOUS_STATES);
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '30', id_carrier: 7 });

      const result = await adapter.write({ type: 'in-progress', externalOrderId: PS_ORDER_ID });

      expect(result).toEqual({ outcome: 'applied' });
      expect(mockHttpClient.createResource).toHaveBeenCalledWith(
        'order_histories',
        { id_order: PS_ORDER_ID, id_order_state: 31 },
        { sendEmail: true }
      );
    });
  });

  // #2286 — the runtime half of the exhaustiveness guard. Before the switch
  // conversion an unrecognised member fell into the cancel branch and could
  // transition a live shop order to `cancelled`.
  describe('unknown member (never-default, #2286)', () => {
    it('returns unsupported without reading or writing the order', async () => {
      mockHttpClient.getResource = jest.fn();

      const result = await adapter.write({
        type: 'amended',
        externalOrderId: PS_ORDER_ID,
      } as unknown as OrderLifecycleEvent);

      expect(result.outcome).toBe('unsupported');
      expect(result.detail).toContain('amended');
      expect(mockHttpClient.getResource).not.toHaveBeenCalled();
      expect(mockHttpClient.createResource).not.toHaveBeenCalled();
    });
  });
});
