/**
 * Mirakl Order Acceptor: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import { MiraklApiException } from '../../../domain/exceptions/mirakl-api.exception';
import { MiraklNetworkException } from '../../../domain/exceptions/mirakl-network.exception';
import type { MiraklOrder } from '../../../domain/types/mirakl-order.types';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import { buildAcceptBody, MiraklOrderAcceptor } from '../mirakl-order-acceptor';
import { buildMiraklOrder, buildMiraklOrderLine } from './mirakl-order.fixture';

function waitingOrder(orderId: string): MiraklOrder {
  return buildMiraklOrder({
    order_id: orderId,
    order_state: 'WAITING_ACCEPTANCE',
    order_lines: [
      buildMiraklOrderLine({ order_line_id: `${orderId}-1`, order_line_state: 'WAITING_ACCEPTANCE' }),
    ],
  });
}

function setup(orders: MiraklOrder[]): { client: IMiraklHttpClient; get: jest.Mock; put: jest.Mock } {
  const get = jest.fn().mockResolvedValue({ status: 200, data: { orders, total_count: orders.length } });
  const put = jest.fn().mockResolvedValue({ status: 204, data: undefined });
  const client = { get, put } as unknown as IMiraklHttpClient;
  return { client, get, put };
}

describe('MiraklOrderAcceptor', () => {
  it('should accept every line of every waiting order', async () => {
    const { client, get, put } = setup([waitingOrder('1001-A'), waitingOrder('1002-A')]);

    const summary = await new MiraklOrderAcceptor('conn-1', client).acceptWaitingOrders();

    expect(summary).toEqual({ accepted: 2, alreadyHandled: 0, failed: 0 });
    expect(get).toHaveBeenCalledWith('/api/orders', {
      queryParams: { order_state_codes: 'WAITING_ACCEPTANCE', max: 100, offset: 0 },
    });
    expect(put).toHaveBeenCalledWith('/api/orders/1001-A/accept', {
      order_lines: [{ id: '1001-A-1', accepted: true }],
    });
  });

  it('should count ORDER_INVALID_STATE as already handled', async () => {
    const { client, put } = setup([waitingOrder('1001-A')]);
    put.mockRejectedValue(
      new MiraklApiException('invalid state', 400, 'ORDER_INVALID_STATE', 'Order is in invalid state'),
    );

    await expect(new MiraklOrderAcceptor('conn-1', client).acceptWaitingOrders()).resolves.toEqual({
      accepted: 0,
      alreadyHandled: 1,
      failed: 0,
    });
  });

  it('should count a line error as failed and carry on with the next order', async () => {
    const { client, put } = setup([waitingOrder('1001-A'), waitingOrder('1002-A')]);
    put
      .mockRejectedValueOnce(new MiraklApiException('line', 400, 'ORDER_LINE_NOT_FOUND'))
      .mockResolvedValueOnce({ status: 204, data: undefined });

    await expect(new MiraklOrderAcceptor('conn-1', client).acceptWaitingOrders()).resolves.toEqual({
      accepted: 1,
      alreadyHandled: 0,
      failed: 1,
    });
  });

  it('should propagate a network failure', async () => {
    const { client, put } = setup([waitingOrder('1001-A')]);
    put.mockRejectedValue(new MiraklNetworkException('timeout'));

    await expect(new MiraklOrderAcceptor('conn-1', client).acceptWaitingOrders()).rejects.toBeInstanceOf(
      MiraklNetworkException,
    );
  });

  it('should send nothing when no order is waiting', async () => {
    const { client, put } = setup([]);

    await new MiraklOrderAcceptor('conn-1', client).acceptWaitingOrders();

    expect(put).not.toHaveBeenCalled();
  });
});

describe('buildAcceptBody', () => {
  it('should leave out lines that are no longer waiting', () => {
    const order = buildMiraklOrder({
      order_lines: [
        buildMiraklOrderLine({ order_line_id: 'a', order_line_state: 'WAITING_ACCEPTANCE' }),
        buildMiraklOrderLine({ order_line_id: 'b', order_line_state: 'REFUSED' }),
        buildMiraklOrderLine({ order_line_id: 'c', order_line_state: undefined }),
      ],
    });

    expect(buildAcceptBody(order)).toEqual({
      order_lines: [
        { id: 'a', accepted: true },
        { id: 'c', accepted: true },
      ],
    });
  });
});
