/**
 * Mirakl Order Status Writer: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import { MiraklApiException } from '../../../domain/exceptions/mirakl-api.exception';
import { MiraklNetworkException } from '../../../domain/exceptions/mirakl-network.exception';
import type { MiraklOrder } from '../../../domain/types/mirakl-order.types';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import { MiraklOrderStatusWriter } from '../mirakl-order-status-writer';
import { buildMiraklOrder } from './mirakl-order.fixture';

function setup(order: MiraklOrder | null): {
  writer: MiraklOrderStatusWriter;
  put: jest.Mock;
} {
  const get = jest
    .fn()
    .mockResolvedValue({ status: 200, data: { orders: order ? [order] : [], total_count: 1 } });
  const put = jest.fn().mockResolvedValue({ status: 204, data: undefined });
  const client = { get, put } as unknown as IMiraklHttpClient;
  return { writer: new MiraklOrderStatusWriter('conn-1', client, 'Empik', {}), put };
}

describe('MiraklOrderStatusWriter dispatched', () => {
  it('should send the tracking number and then ship the order', async () => {
    const { writer, put } = setup(buildMiraklOrder({ order_state: 'SHIPPING' }));

    const result = await writer.write({
      type: 'dispatched',
      externalOrderId: '1001-A',
      trackingNumber: '6200000000001',
      carrier: { platformType: 'inpost' },
    });

    expect(result).toEqual({ outcome: 'applied' });
    expect(put.mock.calls).toEqual([
      [
        '/api/orders/1001-A/tracking',
        { carrier_code: 'paczkomatyinpost', tracking_number: '6200000000001' },
      ],
      ['/api/orders/1001-A/ship'],
    ]);
  });

  it('should ship without tracking when no number is known', async () => {
    const { writer, put } = setup(buildMiraklOrder({ order_state: 'SHIPPING' }));

    await writer.write({ type: 'dispatched', externalOrderId: '1001-A' });

    expect(put.mock.calls).toEqual([['/api/orders/1001-A/ship']]);
  });

  it('should send a missing tracking number to an order already shipped, without shipping again', async () => {
    const { writer, put } = setup(buildMiraklOrder({ order_state: 'SHIPPED' }));

    const result = await writer.write({
      type: 'dispatched',
      externalOrderId: '1001-A',
      trackingNumber: 'TRK',
      carrier: { platformType: 'dpd' },
    });

    expect(result.outcome).toBe('applied');
    expect(put.mock.calls).toEqual([
      ['/api/orders/1001-A/tracking', { carrier_code: 'dpd', tracking_number: 'TRK' }],
    ]);
  });

  it('should not resend the same tracking number, nor send a second parcel number', async () => {
    const same = setup(buildMiraklOrder({ order_state: 'SHIPPED', shipping_tracking: 'TRK' }));
    await same.writer.write({
      type: 'dispatched',
      externalOrderId: '1001-A',
      trackingNumber: 'TRK',
    });
    expect(same.put).not.toHaveBeenCalled();

    const second = setup(buildMiraklOrder({ order_state: 'SHIPPED', shipping_tracking: 'TRK' }));
    const result = await second.writer.write({
      type: 'dispatched',
      externalOrderId: '1001-A',
      trackingNumber: 'TRK-2',
    });
    expect(result.outcome).toBe('applied');
    expect(second.put).not.toHaveBeenCalled();
  });

  it('should reject an order that is cancelled or not accepted yet', async () => {
    const cancelled = setup(buildMiraklOrder({ order_state: 'CANCELED' }));
    expect(
      (await cancelled.writer.write({ type: 'dispatched', externalOrderId: '1001-A' })).outcome
    ).toBe('rejected');

    const waiting = setup(buildMiraklOrder({ order_state: 'WAITING_DEBIT_PAYMENT' }));
    expect(
      (await waiting.writer.write({ type: 'dispatched', externalOrderId: '1001-A' })).outcome
    ).toBe('rejected');
    expect(waiting.put).not.toHaveBeenCalled();
  });

  it('should reject an order Mirakl does not list', async () => {
    const { writer } = setup(null);
    expect((await writer.write({ type: 'dispatched', externalOrderId: 'nope' })).outcome).toBe(
      'rejected'
    );
  });

  it('should report a Mirakl refusal without a code by its status', async () => {
    const { writer, put } = setup(buildMiraklOrder({ order_state: 'SHIPPING' }));
    put.mockRejectedValueOnce(new MiraklApiException('bad', 400));

    const result = await writer.write({
      type: 'dispatched',
      externalOrderId: '1001-A',
      trackingNumber: 'TRK',
    });

    expect(result).toEqual({
      outcome: 'rejected',
      detail: 'Empik refused the update for order 1001-A: HTTP (400)',
    });
  });

  it('should throw a transport failure so the relay treats it as unknown', async () => {
    const { writer, put } = setup(buildMiraklOrder({ order_state: 'SHIPPING' }));
    put.mockRejectedValueOnce(new MiraklNetworkException('timeout'));

    await expect(
      writer.write({ type: 'dispatched', externalOrderId: '1001-A' })
    ).rejects.toBeInstanceOf(MiraklNetworkException);
  });
});

describe('MiraklOrderStatusWriter cancelled', () => {
  it('should cancel an order that has not shipped', async () => {
    const { writer, put } = setup(buildMiraklOrder({ order_state: 'SHIPPING' }));

    expect(await writer.write({ type: 'cancelled', externalOrderId: '1001-A' })).toEqual({
      outcome: 'applied',
    });
    expect(put).toHaveBeenCalledWith('/api/orders/1001-A/cancel');
  });

  it('should treat an already cancelled order as done', async () => {
    const { writer, put } = setup(buildMiraklOrder({ order_state: 'CANCELED' }));

    expect((await writer.write({ type: 'cancelled', externalOrderId: '1001-A' })).outcome).toBe(
      'applied'
    );
    expect(put).not.toHaveBeenCalled();
  });

  it('should reject cancelling a shipped order', async () => {
    const { writer, put } = setup(buildMiraklOrder({ order_state: 'SHIPPED' }));

    expect((await writer.write({ type: 'cancelled', externalOrderId: '1001-A' })).outcome).toBe(
      'rejected'
    );
    expect(put).not.toHaveBeenCalled();
  });
});

describe('MiraklOrderStatusWriter other events', () => {
  it.each(['delivered', 'in-progress'] as const)(
    'should report %s as unsupported',
    async (type) => {
      const { writer, put } = setup(buildMiraklOrder());

      expect((await writer.write({ type, externalOrderId: '1001-A' })).outcome).toBe('unsupported');
      expect(put).not.toHaveBeenCalled();
    }
  );
});
