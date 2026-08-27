/**
 * PrestaShop Order Processor Manager - amount paid vs order value (#2600)
 *
 * PrestaShop records two figures. `total_paid` is what the order is worth,
 * rebuilt from the cart. `total_paid_real` is what has actually reached the
 * seller, and that is the one OpenLinker sends as `amount_paid` with
 * `$dont_touch_amount = true` (ADR-016). For a cash-on-delivery order nothing
 * has reached the seller yet, so sending the total marks the order settled and
 * puts income in the shop's books that it never received.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import {
  createOrderProcessorManagerHarness,
  createTestOrder,
  type OrderProcessorHarness,
} from '../../../__tests__/mocks/prestashop-order-processor-manager.factory';
import type { OrderCreate } from '@openlinker/core/orders';

describe('PrestashopOrderProcessorManagerAdapter - amount paid (#2600)', () => {
  let harness: OrderProcessorHarness;

  beforeEach(() => {
    harness = createOrderProcessorManagerHarness();
    harness.mockIdentifierMapping.getExternalIds = jest
      .fn()
      .mockImplementation((entityType: string) =>
        Promise.resolve([{ connectionId: harness.connection.id, externalId: '42', entityType }])
      ) as typeof harness.mockIdentifierMapping.getExternalIds;
    harness.setCreateResourceDispatch({ id: '123' }, { id: '999', reference: 'ORDER-1' });
  });

  async function importedAmountPaid(order: OrderCreate): Promise<number> {
    await harness.adapter.createOrder(order);
    const call = harness.mockOpenLinkerModuleClient.importOrder.mock.calls.at(-1);
    return (call?.[0] as { amountPaid: number }).amountPaid;
  }

  it('sends 0 for a cash-on-delivery order so the full value stays outstanding', async () => {
    const order = createTestOrder({ paymentStatus: 'cod' });

    await expect(importedAmountPaid(order)).resolves.toBe(0);
  });

  it('sends 0 for an order still awaiting payment', async () => {
    const order = createTestOrder({ paymentStatus: 'awaiting' });

    await expect(importedAmountPaid(order)).resolves.toBe(0);
  });

  it('sends the buyer-paid total for a prepaid order', async () => {
    const order = createTestOrder({ paymentStatus: 'paid' });

    await expect(importedAmountPaid(order)).resolves.toBe(order.totals.total);
  });

  it('sends the total unchanged when the source reported no payment status', async () => {
    // Absent is not "unpaid". Guessing zero here would leave every order from
    // a source that reports nothing looking unsettled.
    const order = createTestOrder();
    expect(order.paymentStatus).toBeUndefined();

    await expect(importedAmountPaid(order)).resolves.toBe(order.totals.total);
  });

  it('does not read the payment-method name', async () => {
    // A COD payment module with a prepaid status is still prepaid as far as the
    // source is concerned, and the source is the only authority here.
    const order = createTestOrder({
      paymentStatus: 'paid',
      metadata: { paymentMethodName: 'Cash on delivery' },
    });

    await expect(importedAmountPaid(order)).resolves.toBe(order.totals.total);
  });
});
