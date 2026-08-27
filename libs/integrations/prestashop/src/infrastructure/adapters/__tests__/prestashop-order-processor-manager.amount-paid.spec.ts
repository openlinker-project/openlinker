/**
 * PrestaShop Order Processor Manager - amount paid vs order value (#2600)
 *
 * PrestaShop records two figures. `total_paid` is what the order is worth,
 * rebuilt from the cart. `total_paid_real` is what has reached the seller.
 *
 * `amount_paid` cannot carry the second figure on its own. `validateOrder`
 * starts `total_paid_real` at 0 and raises it only from `addOrderPayment`,
 * which runs only for a `logable` state, and on a logable state an amount that
 * differs from the cart total makes it drop the requested state and use
 * "Payment error". So the order's state, not the amount, decides whether the
 * shop books the sale - and the amount must always be the full total or the
 * order lands somewhere nobody asked for.
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
  let warnings: string[];

  beforeEach(() => {
    harness = createOrderProcessorManagerHarness();
    harness.mockIdentifierMapping.getExternalIds = jest
      .fn()
      .mockImplementation((entityType: string) =>
        Promise.resolve([{ connectionId: harness.connection.id, externalId: '42', entityType }])
      ) as typeof harness.mockIdentifierMapping.getExternalIds;
    harness.setCreateResourceDispatch({ id: '123' }, { id: '999', reference: 'ORDER-1' });
    warnings = [];
    jest
      .spyOn((harness.adapter as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
      .mockImplementation((message: unknown) => {
        warnings.push(String(message));
      });
  });

  async function importOrder(order: OrderCreate): Promise<{ amountPaid: number; stateId: number }> {
    await harness.adapter.createOrder(order);
    const call = harness.mockOpenLinkerModuleClient.importOrder.mock.calls.at(-1);
    const payload = call?.[0] as { amountPaid: number; idOrderState: number };
    return { amountPaid: payload.amountPaid, stateId: payload.idOrderState };
  }

  // The cart total is what PaymentModule compares `amount_paid` against, and
  // OpenLinker rebuilds the cart from these same totals, so any figure other
  // than the total is a mismatch on the shop side.
  it.each([['cod'], ['awaiting'], ['paid']] as const)(
    'sends the full order value for paymentStatus=%s so the requested state survives',
    async (paymentStatus) => {
      const order = createTestOrder({ paymentStatus });

      await expect(importOrder(order)).resolves.toMatchObject({
        amountPaid: order.totals.total,
      });
    }
  );

  it('sends the full order value when the source reported no payment status', async () => {
    const order = createTestOrder();
    expect(order.paymentStatus).toBeUndefined();

    await expect(importOrder(order)).resolves.toMatchObject({ amountPaid: order.totals.total });
  });

  it('imports a cash-on-delivery order into the state that was asked for, not "Payment error"', async () => {
    // The regression this replaces sent 0 here. On a default install
    // `processing` resolves to id 2 "Payment accepted", which is logable, so
    // PaymentModule would have discarded id 2 and used PS_OS_ERROR (id 8).
    const order = createTestOrder({ paymentStatus: 'cod', status: 'processing' });

    const imported = await importOrder(order);

    expect(imported.stateId).toBe(2);
    expect(imported.amountPaid).toBe(order.totals.total);
  });

  it('warns that a cash-on-delivery order is being booked as settled', async () => {
    // OpenLinker will not move the order to a state the operator did not ask
    // for, so the only honest thing left is to say what the shop will record.
    const order = createTestOrder({ paymentStatus: 'cod', status: 'processing' });

    await importOrder(order);

    expect(warnings.some((line) => line.includes('booked as settled'))).toBe(true);
  });

  it('stays quiet when the target state does not count as a sale', async () => {
    // `pending` resolves to id 1 "Awaiting check payment", which is not
    // logable, so `total_paid_real` stays 0 and there is nothing to warn about.
    const order = createTestOrder({ paymentStatus: 'cod', status: 'pending' });

    const imported = await importOrder(order);

    expect(imported.stateId).toBe(1);
    expect(warnings.some((line) => line.includes('booked as settled'))).toBe(false);
  });

  it('stays quiet for a prepaid order in a state that counts as a sale', async () => {
    const order = createTestOrder({ paymentStatus: 'paid', status: 'processing' });

    await importOrder(order);

    expect(warnings.some((line) => line.includes('booked as settled'))).toBe(false);
  });

  it('does not read the payment-method name', async () => {
    const order = createTestOrder({
      paymentStatus: 'paid',
      metadata: { paymentMethodName: 'Cash on delivery' },
    });

    await expect(importOrder(order)).resolves.toMatchObject({ amountPaid: order.totals.total });
  });
});
