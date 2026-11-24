/**
 * Mirakl Refunds: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import type { ExecuteRefundCommand } from '@openlinker/core/orders';
import { InMemoryCacheAdapter } from '@openlinker/shared/cache/testing';
import { MiraklApiException } from '../../../domain/exceptions/mirakl-api.exception';
import { MiraklRefundInDoubtException } from '../../../domain/exceptions/mirakl-refund-in-doubt.exception';
import type { MiraklOrder } from '../../../domain/types/mirakl-order.types';
import { empikOperatorProfile } from '../../../operators/empik.profile';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import { MiraklRefundExecutor, MiraklRefundReader } from '../mirakl-refunds';

const ORDER: MiraklOrder = {
  order_id: '1001-A',
  currency_iso_code: 'PLN',
  order_tax_mode: 'TAX_INCLUDED',
  order_lines: [
    {
      order_line_id: '1001-A-1',
      price: 30,
      shipping_price: 10,
      taxes: [{ code: 'VAT', amount: 5.61 }],
      refunds: [],
    },
    { order_line_id: '1001-A-2', price: 20, shipping_price: 0, refunds: [] },
  ],
};

function fakeHttp(order: MiraklOrder | null = ORDER): {
  client: IMiraklHttpClient;
  get: jest.Mock;
  put: jest.Mock;
} {
  const get = jest.fn(() =>
    Promise.resolve({ status: 200, data: { orders: order ? [order] : [] } })
  );
  const put = jest.fn(() =>
    Promise.resolve({
      status: 200,
      data: { refunds: [{ refund_id: 'R-1', order_refund_id: 'OR-1' }] },
    })
  );
  return { client: { get, put } as unknown as IMiraklHttpClient, get, put };
}

function command(overrides: Partial<ExecuteRefundCommand> = {}): ExecuteRefundCommand {
  return {
    externalOrderId: '1001-A',
    externalReturnId: null,
    amount: '35.00',
    currency: 'PLN',
    reason: 'defective',
    note: null,
    idempotencyKey: 'refund-key-1',
    ...overrides,
  };
}

function executor(
  http: IMiraklHttpClient,
  cache: InMemoryCacheAdapter | undefined = new InMemoryCacheAdapter()
): MiraklRefundExecutor {
  return new MiraklRefundExecutor(
    'conn-1',
    http,
    'Empik',
    empikOperatorProfile.refundReasonCodes,
    cache
  );
}

describe('MiraklRefundExecutor', () => {
  it('should spread the amount over product parts first, then shipping', async () => {
    const http = fakeHttp();

    const result = await executor(http.client).executeRefund(command({ amount: '55.00' }));

    expect(result).toMatchObject({
      outcome: 'accepted',
      providerRefundId: 'OR-1',
      refundedAt: null,
    });
    const [path, body] = http.put.mock.calls[0] as [string, { refunds: unknown[] }];
    expect(path).toBe('/api/orders/refund');
    expect(body).toEqual({
      order_tax_mode: 'TAX_INCLUDED',
      refunds: [
        {
          order_line_id: '1001-A-1',
          amount: 30,
          shipping_amount: 5,
          currency_iso_code: 'PLN',
          reason_code: 'REFUND_21',
          taxes: [{ code: 'VAT', amount: 5.61 }],
        },
        {
          order_line_id: '1001-A-2',
          amount: 20,
          shipping_amount: 0,
          currency_iso_code: 'PLN',
          reason_code: 'REFUND_21',
        },
      ],
    });
  });

  it('should refund taxes in proportion to the part refunded', async () => {
    const http = fakeHttp();

    await executor(http.client).executeRefund(command({ amount: '15.00' }));

    const [, body] = http.put.mock.calls[0] as [
      string,
      { refunds: Array<Record<string, unknown>> },
    ];
    expect(body.refunds).toEqual([
      expect.objectContaining({
        amount: 15,
        shipping_amount: 0,
        taxes: [{ code: 'VAT', amount: 2.8 }],
      }),
    ]);
  });

  it('should count what was already refunded on a line', async () => {
    const http = fakeHttp({
      ...ORDER,
      order_lines: [
        { order_line_id: 'L1', price: 30, shipping_price: 0, refunds: [{ amount: 25 }] },
      ],
    });

    const result = await executor(http.client).executeRefund(command({ amount: '10.00' }));

    expect(result.outcome).toBe('denied');
    expect(result.providerMessage).toContain('5.00 PLN left');
    expect(http.put).not.toHaveBeenCalled();
  });

  it('should answer a repeated key from the first refund without sending again', async () => {
    const http = fakeHttp();
    const cache = new InMemoryCacheAdapter();

    await executor(http.client, cache).executeRefund(command());
    const second = await executor(http.client, cache).executeRefund(command());

    expect(http.put).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ outcome: 'accepted', providerRefundId: 'OR-1' });
  });

  it('should treat a key whose first attempt did not finish as in doubt', async () => {
    const http = fakeHttp();
    http.put.mockRejectedValueOnce(new Error('socket hang up'));
    const cache = new InMemoryCacheAdapter();

    await expect(executor(http.client, cache).executeRefund(command())).rejects.toThrow(
      'socket hang up'
    );
    await expect(executor(http.client, cache).executeRefund(command())).rejects.toBeInstanceOf(
      MiraklRefundInDoubtException
    );
    expect(http.put).toHaveBeenCalledTimes(1);
  });

  it('should deny a 4xx refusal and free the key for a corrected retry', async () => {
    const http = fakeHttp();
    http.put.mockRejectedValueOnce(new MiraklApiException('bad', 400, 'INVALID'));
    const cache = new InMemoryCacheAdapter();

    const first = await executor(http.client, cache).executeRefund(command());
    const second = await executor(http.client, cache).executeRefund(command());

    expect(first.outcome).toBe('denied');
    expect(second.outcome).toBe('accepted');
  });

  it('should send nothing without a cache, an order or a matching currency', async () => {
    const http = fakeHttp();

    expect((await executor(http.client, undefined).executeRefund(command())).outcome).toBe(
      'denied'
    );
    expect((await executor(fakeHttp(null).client).executeRefund(command())).outcome).toBe('denied');
    expect((await executor(http.client).executeRefund(command({ currency: 'EUR' }))).outcome).toBe(
      'denied'
    );
    expect((await executor(http.client).executeRefund(command({ amount: '1.234' }))).outcome).toBe(
      'denied'
    );
    expect(http.put).not.toHaveBeenCalled();
  });
});

describe('MiraklRefundReader', () => {
  it('should report each paid line refund with its own amount and payment instant', async () => {
    const http = fakeHttp({
      ...ORDER,
      order_lines: [
        {
          order_line_id: 'L1',
          refunds: [
            {
              id: 'R-1',
              amount: 30,
              shipping_amount: 5,
              refund_state: 'REFUNDED',
              transaction_date: '2026-11-24T10:00:00Z',
            },
            { id: 'R-2', amount: 10, refund_state: 'WAITING_REFUND' },
            { id: 'R-3', amount: 4, state: 'REFUNDED' },
          ],
        },
      ],
    });

    const refunds = await new MiraklRefundReader(http.client).listRefunds({
      externalOrderId: '1001-A',
    });

    expect(refunds).toEqual([
      {
        externalRefundId: 'R-1',
        amount: '35.00',
        currency: 'PLN',
        occurredAt: new Date('2026-11-24T10:00:00Z'),
      },
      { externalRefundId: 'R-3', amount: '4.00', currency: 'PLN', occurredAt: null },
    ]);
  });

  it('should report nothing for an order Mirakl does not have', async () => {
    const refunds = await new MiraklRefundReader(fakeHttp(null).client).listRefunds({
      externalOrderId: 'X',
    });

    expect(refunds).toEqual([]);
  });
});
