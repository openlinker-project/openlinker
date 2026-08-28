/**
 * PrestaShop Order Processor Manager - shop-derived order-state mapping (#2607)
 *
 * Both directions now resolve against the shop's own `ps_order_state` rows, so
 * these tests defend the two claims that matter to an operator: a status write
 * lands in a state that really means what OpenLinker asked for, and the
 * mapping UI is told which of the shop's states OpenLinker can read.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import {
  createOrderProcessorManagerHarness,
  type OrderProcessorHarness,
  createTestOrder,
} from '../../../__tests__/mocks/prestashop-order-processor-manager.factory';
import { PrestashopOrderStateUnresolvedException } from '../../../domain/exceptions/prestashop-order-state-unresolved.exception';
import { PrestashopRetryClassifierAdapter } from '../prestashop-retry-classifier.adapter';

/** A shop that renamed and renumbered everything, which real shops do. */
const CUSTOM_STATES: ReadonlyArray<Record<string, unknown>> = [
  { id: '20', name: 'New order', deleted: '0', paid: '0', shipped: '0', delivered: '0' },
  { id: '21', name: 'Paid, picking', deleted: '0', paid: '1', shipped: '0', delivered: '0' },
  { id: '22', name: 'Handed to courier', deleted: '0', paid: '1', shipped: '1', delivered: '0' },
  { id: '23', name: 'Signed for', deleted: '0', paid: '1', shipped: '1', delivered: '1' },
  { id: '24', name: 'Anulowane', deleted: '0', paid: '0', shipped: '0', delivered: '0' },
];

function serveStates(
  harness: OrderProcessorHarness,
  rows: ReadonlyArray<Record<string, unknown>>
): void {
  harness.mockHttpClient.listResources = jest
    .fn()
    .mockImplementation((resource: string) =>
      Promise.resolve(resource === 'order_states' ? [...rows] : [])
    ) as typeof harness.mockHttpClient.listResources;
}

describe('PrestashopOrderProcessorManagerAdapter - order-state mapping (#2607)', () => {
  let harness: OrderProcessorHarness;

  beforeEach(() => {
    harness = createOrderProcessorManagerHarness();
  });

  describe('listOrderStatuses', () => {
    it('reports the neutral status it derives for each of the shop own states', async () => {
      serveStates(harness, CUSTOM_STATES);

      const options = await harness.adapter.listOrderStatuses();

      expect(options).toEqual([
        { value: '20', label: 'New order', derivedValue: 'pending' },
        { value: '21', label: 'Paid, picking', derivedValue: 'processing' },
        { value: '22', label: 'Handed to courier', derivedValue: 'shipped' },
        { value: '23', label: 'Signed for', derivedValue: 'delivered' },
        { value: '24', label: 'Anulowane', derivedValue: 'cancelled' },
      ]);
    });
  });

  describe('status writeback against a customised catalogue', () => {
    it('ships to the shop own shipped state, not the default-install id 4', async () => {
      serveStates(harness, CUSTOM_STATES);
      harness.mockHttpClient.getResource = jest.fn().mockResolvedValue({
        id: '5001',
        current_state: '21',
      }) as typeof harness.mockHttpClient.getResource;

      const result = await harness.adapter.write({
        type: 'dispatched',
        externalOrderId: '5001',
        trackingNumber: 'TRK1',
      });

      expect(result.outcome).toBe('applied');
      expect(harness.mockHttpClient.createResource).toHaveBeenCalledWith(
        'order_histories',
        expect.objectContaining({ id_order_state: 22 }),
        expect.anything()
      );
    });

    it('refuses a cancel when the shop own shipped state already holds the order', async () => {
      serveStates(harness, CUSTOM_STATES);
      harness.mockHttpClient.getResource = jest.fn().mockResolvedValue({
        id: '5001',
        current_state: '22',
      }) as typeof harness.mockHttpClient.getResource;

      const result = await harness.adapter.write({
        type: 'cancelled',
        externalOrderId: '5001',
      });

      expect(result.outcome).toBe('rejected');
    });

    it('refuses the write rather than guessing an id when no state means the status', async () => {
      // A shop with no cancellation state at all. Writing id 6 here would move
      // the order into whatever that number happens to be.
      serveStates(
        harness,
        CUSTOM_STATES.filter((row) => row.id !== '24')
      );
      harness.mockHttpClient.getResource = jest.fn().mockResolvedValue({
        id: '5001',
        current_state: '21',
      }) as typeof harness.mockHttpClient.getResource;

      const result = await harness.adapter.write({
        type: 'cancelled',
        externalOrderId: '5001',
      });

      // `write` never throws by contract (#1158), so the refusal surfaces as
      // the outcome plus a detail that names the fix. What matters is that no
      // `order_histories` row was written against a guessed id.
      expect(result.outcome).toBe('rejected');
      expect(result.detail).toContain('order-status mappings');
      expect(harness.mockHttpClient.createResource).not.toHaveBeenCalled();
    });
  });

  describe('the refusal reaches the retry classifier (#2607 review)', () => {
    // The class is registered as non-retryable, but both catch blocks used to
    // wrap it into a generic API failure, so the terminal arm never fired and
    // a refusal only an operator can clear burned the whole retry ladder.
    const classifier = new PrestashopRetryClassifierAdapter();

    it('lets updateFulfillment throw the class unwrapped', async () => {
      serveStates(
        harness,
        CUSTOM_STATES.filter((row) => row.id !== '24')
      );
      harness.mockHttpClient.getResource = jest.fn().mockResolvedValue({
        id: '5001',
        current_state: '21',
      }) as typeof harness.mockHttpClient.getResource;

      const thrown = await harness.adapter
        .updateFulfillment({ externalOrderId: '5001', status: 'cancelled' })
        .then(
          () => null,
          (error: unknown) => error
        );

      expect(thrown).toBeInstanceOf(PrestashopOrderStateUnresolvedException);
      expect(classifier.isNonRetryable(thrown)).toBe(true);
    });

    it('lets createOrder throw the class unwrapped', async () => {
      // createOrder also discovers the OL Dynamic carrier through this client,
      // so both reads have to be served or the failure is the wrong one.
      harness.mockHttpClient.listResources = jest
        .fn()
        .mockImplementation((resource: string, params?: { custom?: Record<string, unknown> }) => {
          if (resource === 'order_states') {
            return Promise.resolve([{ id: '20', name: 'New order', deleted: '0', paid: '0' }]);
          }
          if (resource === 'carriers' && params?.custom?.external_module_name === 'openlinker') {
            return Promise.resolve([{ id: '77', active: '1', deleted: '0' }]);
          }
          return Promise.resolve([]);
        }) as typeof harness.mockHttpClient.listResources;
      harness.mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockImplementation((entityType: string) =>
          Promise.resolve([{ connectionId: harness.connection.id, externalId: '42', entityType }])
        ) as typeof harness.mockIdentifierMapping.getExternalIds;
      harness.setCreateResourceDispatch({ id: '123' }, { id: '999', reference: 'ORDER-1' });

      const thrown = await harness.adapter.createOrder(createTestOrder({ status: 'shipped' })).then(
        () => null,
        (error: unknown) => error
      );

      expect(thrown).toBeInstanceOf(PrestashopOrderStateUnresolvedException);
      expect(classifier.isNonRetryable(thrown)).toBe(true);
    });

    it('classifies the class as terminal', () => {
      const refusal = new PrestashopOrderStateUnresolvedException('cancelled', 'conn-1');

      expect(classifier.isNonRetryable(refusal)).toBe(true);
      expect(classifier.getRetryDeferral(refusal)).toBeNull();
    });
  });
});
