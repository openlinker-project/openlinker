import type { ExecuteRefundCommand } from '@openlinker/core/orders';

import { ShopifyRefundInDoubtException } from '../../../../domain/exceptions/shopify-refund-in-doubt.exception';
import { ShopifyUserErrorsException } from '../../../../domain/exceptions/shopify-user-errors.exception';
import type { ShopifyGraphqlClient } from '../../../http/shopify-graphql-client';
import { ShopifyRefundExecutor } from '../shopify-refund-executor';

const COMMAND = {
  externalOrderId: '1018',
  amount: '60.27',
  currency: 'PLN',
  reason: 'withdrawal',
  idempotencyKey: 'return:r1:refund:1',
} as unknown as ExecuteRefundCommand;

function target(overrides: Record<string, unknown> = {}): unknown {
  return {
    order: {
      id: 'gid://shopify/Order/1018',
      currencyCode: 'PLN',
      presentmentCurrencyCode: 'PLN',
      refunds: [],
      suggestedRefund: {
        suggestedTransactions: [
          {
            gateway: 'manual',
            kind: 'SUGGESTED_REFUND',
            parentTransaction: { id: 'gid://shopify/OrderTransaction/9' },
            maximumRefundableSet: { presentmentMoney: { amount: '146.61', currencyCode: 'PLN' } },
          },
        ],
      },
      ...overrides,
    },
  };
}

const refund = (status: string, note = 'OpenLinker refund'): Record<string, unknown> => ({
  id: 'gid://shopify/Refund/55',
  note,
  createdAt: '2026-11-05T10:00:00Z',
  transactions: { nodes: [{ status, processedAt: '2026-11-05T10:00:01Z' }] },
});

function build(query: jest.Mock, mutate: jest.Mock = jest.fn()): ShopifyRefundExecutor {
  return new ShopifyRefundExecutor({ query, mutate } as unknown as ShopifyGraphqlClient, 'c1');
}

describe('ShopifyRefundExecutor', () => {
  it('should refund against the order own transaction, idempotently, with Shopify own instant (C20)', async () => {
    const query = jest.fn().mockResolvedValue(target());
    const mutate = jest.fn().mockResolvedValue({ refund: refund('SUCCESS') });

    const result = await build(query, mutate).executeRefund(COMMAND);

    expect(result).toEqual({
      outcome: 'refunded',
      providerRefundId: '55',
      refundedAt: new Date('2026-11-05T10:00:01Z'),
      providerMessage: null,
    });
    const variables = (mutate.mock.calls[0] as unknown[])[1] as {
      key: string;
      input: { note: string; transactions: Array<Record<string, unknown>> };
    };
    expect(variables.key).toMatch(/^ol-refund-[0-9a-f]{48}$/);
    expect(variables.input.note).toMatch(/\[ol:[0-9a-f]{16}\]/);
    expect(variables.input.transactions).toEqual([
      {
        orderId: 'gid://shopify/Order/1018',
        parentId: 'gid://shopify/OrderTransaction/9',
        gateway: 'manual',
        kind: 'REFUND',
        amount: '60.27',
      },
    ]);
  });

  it('should answer from a refund already carrying its marker instead of refunding again', async () => {
    const first = jest.fn().mockResolvedValue(target());
    const mutate = jest.fn().mockResolvedValue({ refund: refund('SUCCESS') });
    await build(first, mutate).executeRefund(COMMAND);
    const marker = /\[ol:[0-9a-f]{16}\]/.exec(((mutate.mock.calls[0] as unknown[])[1] as { input: { note: string } }).input.note)?.[0];

    const again = jest.fn().mockResolvedValue(target({ refunds: [refund('SUCCESS', `OpenLinker refund ${marker}`)] }));
    const secondMutate = jest.fn();
    await expect(build(again, secondMutate).executeRefund(COMMAND)).resolves.toMatchObject({ outcome: 'refunded' });
    expect(secondMutate).not.toHaveBeenCalled();
  });

  it.each([
    ['more than is left to refund', { ...COMMAND, amount: '200.00' }, target()],
    ['an amount with three decimals', { ...COMMAND, amount: '1.005' }, target()],
    ['another currency', { ...COMMAND, currency: 'EUR' }, target()],
    ['a multi-currency order', COMMAND, target({ presentmentCurrencyCode: 'EUR' })],
  ])('should deny %s before sending anything', async (_label, command, answer) => {
    const mutate = jest.fn();

    await expect(
      build(jest.fn().mockResolvedValue(answer), mutate).executeRefund(command as ExecuteRefundCommand),
    ).resolves.toMatchObject({ outcome: 'denied', providerRefundId: null });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('should deny a refund Shopify refuses and report a pending one as accepted', async () => {
    const refused = jest
      .fn()
      .mockRejectedValue(new ShopifyUserErrorsException('refundCreate', [{ message: 'Amount exceeds refundable' }]));
    await expect(build(jest.fn().mockResolvedValue(target()), refused).executeRefund(COMMAND)).resolves.toMatchObject({
      outcome: 'denied',
    });

    const pending = jest.fn().mockResolvedValue({ refund: refund('PENDING') });
    await expect(build(jest.fn().mockResolvedValue(target()), pending).executeRefund(COMMAND)).resolves.toMatchObject({
      outcome: 'accepted',
    });
  });

  it('should report a refund in doubt when its transactions partly failed or Shopify answered without one', async () => {
    const partly = jest.fn().mockResolvedValue({
      refund: {
        ...refund('SUCCESS'),
        transactions: { nodes: [{ status: 'SUCCESS', processedAt: null }, { status: 'FAILURE', processedAt: null }] },
      },
    });
    await expect(build(jest.fn().mockResolvedValue(target()), partly).executeRefund(COMMAND)).rejects.toBeInstanceOf(
      ShopifyRefundInDoubtException,
    );

    const empty = jest.fn().mockResolvedValue({ refund: null });
    await expect(build(jest.fn().mockResolvedValue(target()), empty).executeRefund(COMMAND)).rejects.toBeInstanceOf(
      ShopifyRefundInDoubtException,
    );
  });
});
