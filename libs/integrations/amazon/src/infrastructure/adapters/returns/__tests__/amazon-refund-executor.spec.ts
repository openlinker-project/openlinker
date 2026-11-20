/**
 * AmazonRefundExecutor tests (#4184)
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/returns/__tests__
 */
import type { ExecuteRefundCommand } from '@openlinker/core/orders';
import { InMemoryCacheAdapter } from '@openlinker/shared/cache/testing';

import type { AmazonOrder } from '../../../../domain/types/amazon-order.types';
import type { AmazonFeedsClient } from '../../../http/amazon-feeds.client';
import { AmazonRefundExecutor } from '../amazon-refund-executor';
import type { AmazonReturnReader } from '../amazon-return-reader';

const order = (fulfilledBy = 'MERCHANT'): AmazonOrder =>
  ({
    orderId: '302-1',
    salesChannel: { channelName: 'Amazon.de', marketplaceId: 'A1PA6795UKMFR9' },
    fulfillment: { fulfilledBy },
    orderItems: [
      { orderItemId: 'I1', quantityOrdered: 2, product: { sellerSku: 'MUG', price: { unitPrice: { amount: '10.00', currencyCode: 'EUR' } } } },
      { orderItemId: 'I2', quantityOrdered: 1, product: { sellerSku: 'CUP', price: { unitPrice: { amount: '5.00', currencyCode: 'EUR' } } } },
    ],
  }) as unknown as AmazonOrder;

const command = (overrides: Partial<ExecuteRefundCommand> = {}): ExecuteRefundCommand => ({
  externalOrderId: '302-1',
  externalReturnId: 'RMA1',
  amount: '10.00',
  currency: 'EUR',
  reason: 'defective',
  note: null,
  idempotencyKey: 'refund:ret-1:l1',
  ...overrides,
});

const eur = (amount: string): { amount: string; currencyCode: string } => ({ amount, currencyCode: 'EUR' });
const usd = (amount: string): { amount: string; currencyCode: string } => ({ amount, currencyCode: 'USD' });

/** One MUG listed at 20.00, discounted by 5.00, VAT inside the price: the buyer paid 15.00. */
const discountedOrder = (): AmazonOrder =>
  ({
    orderId: '302-1',
    salesChannel: { channelName: 'Amazon.de', marketplaceId: 'A1PA6795UKMFR9' },
    fulfillment: { fulfilledBy: 'MERCHANT' },
    proceeds: { grandTotal: eur('15.00') },
    orderItems: [
      {
        orderItemId: 'I1',
        quantityOrdered: 1,
        product: { sellerSku: 'MUG', price: { unitPrice: eur('20.00') } },
        proceeds: {
          breakdowns: [
            { type: 'ITEM', subtotal: eur('20.00') },
            { type: 'DISCOUNT', subtotal: eur('-5.00') },
            { type: 'TAX', subtotal: eur('2.81') },
          ],
        },
      },
    ],
  }) as unknown as AmazonOrder;

/** One MUG at 10.00 with 1.00 sales tax added on top: the buyer paid 11.00. */
const salesTaxOrder = (): AmazonOrder =>
  ({
    orderId: '111-1',
    salesChannel: { channelName: 'Amazon.com', marketplaceId: 'ATVPDKIKX0DER' },
    fulfillment: { fulfilledBy: 'MERCHANT' },
    proceeds: { grandTotal: usd('11.00') },
    orderItems: [
      {
        orderItemId: 'I1',
        quantityOrdered: 1,
        product: { sellerSku: 'MUG', price: { unitPrice: usd('10.00') } },
        proceeds: {
          breakdowns: [
            { type: 'ITEM', subtotal: usd('10.00') },
            { type: 'TAX', subtotal: usd('1.00') },
          ],
        },
      },
    ],
  }) as unknown as AmazonOrder;

const SUCCESS_REPORT = 'Number of records processed\t\t1\nNumber of records successful\t\t1\n';

function setup(fulfilledBy?: string, theOrder?: AmazonOrder): {
  executor: AmazonRefundExecutor;
  feeds: jest.Mocked<AmazonFeedsClient>;
  cache: InMemoryCacheAdapter;
} {
  const feeds = {
    uploadFeedDocument: jest.fn().mockResolvedValue('DOC1'),
    createFeed: jest.fn().mockResolvedValue('FEED1'),
    getFeed: jest
      .fn()
      .mockResolvedValue({ feedId: 'FEED1', processingStatus: 'DONE', resultFeedDocumentId: 'RES1', processingEndTime: '2026-11-18T10:05:00Z' }),
    downloadResult: jest.fn().mockResolvedValue(SUCCESS_REPORT),
  } as unknown as jest.Mocked<AmazonFeedsClient>;
  const returns = {
    cached: jest.fn().mockResolvedValue({
      rmaId: 'RMA1',
      orderId: '302-1',
      status: 'Approved',
      requestedAt: '2026-11-10T00:00:00Z',
      lines: [{ sku: 'MUG', asin: null, name: null, quantity: 1, reason: null, unitPrice: null }],
    }),
  } as unknown as AmazonReturnReader;
  const cache = new InMemoryCacheAdapter();
  let clock = 0;
  const executor = new AmazonRefundExecutor({
    connectionId: 'conn-amz',
    marketplaceIds: ['A1PA6795UKMFR9'],
    feeds,
    returns,
    readOrder: jest.fn().mockResolvedValue(theOrder ?? order(fulfilledBy)),
    cache,
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
    now: () => clock,
  });
  return { executor, feeds, cache };
}

describe('AmazonRefundExecutor', () => {
  it('should send one adjustment row per returned item and report the refund with Amazon\'s instant', async () => {
    const { executor, feeds } = setup();

    const result = await executor.executeRefund(command());

    expect(feeds.uploadFeedDocument.mock.calls[0][0]).toBe(
      'order-id\torder-item-id\tadjustment-reason-code\tcurrency\titem-price-adj\titem-tax-adj\tshipping-price-adj\tshipping-tax-adj\n' +
        '302-1\tI1\tCustomerReturn\tEUR\t10.00\t0.00\t0.00\t0.00\n',
    );
    expect(feeds.createFeed).toHaveBeenCalledWith('POST_FLAT_FILE_PAYMENT_ADJUSTMENT_DATA', ['A1PA6795UKMFR9'], 'DOC1');
    expect(result).toEqual({
      outcome: 'refunded',
      providerRefundId: 'FEED1',
      refundedAt: new Date('2026-11-18T10:05:00Z'),
      providerMessage: null,
    });
  });

  it('should not submit twice under one key', async () => {
    const { executor, feeds } = setup();

    await executor.executeRefund(command());
    await executor.executeRefund(command());

    expect(feeds.createFeed).toHaveBeenCalledTimes(1);
  });

  it('should treat a run that stopped while submitting as unknown', async () => {
    const { executor, cache, feeds } = setup();
    await cache.set('amazon:refund:conn-amz:refund:ret-1:l1', { state: 'submitting' }, 60);

    await expect(executor.executeRefund(command())).rejects.toThrow(/Seller Central/);
    expect(feeds.createFeed).not.toHaveBeenCalled();
  });

  it('should report Amazon\'s reason when every row is refused', async () => {
    const { executor, feeds } = setup();
    feeds.downloadResult.mockResolvedValue(
      'Number of records processed\t\t1\nNumber of records successful\t\t0\n\noriginal-record-number\terror-code\terror-type\terror-message\n1\t1\tError\tAmount exceeds amount paid\n',
    );

    await expect(executor.executeRefund(command())).resolves.toEqual({
      outcome: 'denied',
      providerRefundId: 'FEED1',
      refundedAt: null,
      providerMessage: 'Amount exceeds amount paid',
    });
  });

  it('should report a feed still running as accepted', async () => {
    const { executor, feeds } = setup();
    feeds.getFeed.mockResolvedValue({ feedId: 'FEED1', processingStatus: 'IN_PROGRESS' });

    await expect(executor.executeRefund(command())).resolves.toEqual(
      expect.objectContaining({ outcome: 'accepted', providerRefundId: 'FEED1' }),
    );
  });

  it('should refuse before sending anything for an Amazon-fulfilled order or too large an amount', async () => {
    const fba = setup('AMAZON');
    await expect(fba.executor.executeRefund(command())).resolves.toEqual(expect.objectContaining({ outcome: 'denied' }));
    expect(fba.feeds.uploadFeedDocument).not.toHaveBeenCalled();

    const big = setup();
    await expect(big.executor.executeRefund(command({ amount: '10.01' }))).resolves.toEqual(
      expect.objectContaining({ outcome: 'denied' }),
    );
    expect(big.feeds.uploadFeedDocument).not.toHaveBeenCalled();
  });

  it('should throw when the feed submission itself fails, since Amazon may have it', async () => {
    const { executor, feeds } = setup();
    feeds.createFeed.mockRejectedValue(new Error('socket hang up'));

    await expect(executor.executeRefund(command())).rejects.toThrow('socket hang up');
  });

  it('should throw for a feed that refunded only some rows', async () => {
    const { executor, feeds } = setup();
    feeds.downloadResult.mockResolvedValue(
      'Number of records processed\t\t2\nNumber of records successful\t\t1\n\noriginal-record-number\terror-type\terror-message\n2\tError\tBad item\n',
    );

    await expect(executor.executeRefund(command({ externalReturnId: null, amount: '25.00' }))).rejects.toThrow(/only part/);
  });

  it('should bound the refund by what the buyer paid after the discount, not the list price', async () => {
    const paid = setup(undefined, discountedOrder());
    await paid.executor.executeRefund(command({ amount: '15.00' }));
    expect(paid.feeds.uploadFeedDocument.mock.calls[0][0]).toContain('302-1\tI1\tCustomerReturn\tEUR\t15.00\t0.00\t0.00\t0.00');

    const over = setup(undefined, discountedOrder());
    await expect(over.executor.executeRefund(command({ amount: '15.01' }))).resolves.toEqual(
      expect.objectContaining({ outcome: 'denied' }),
    );
    expect(over.feeds.uploadFeedDocument).not.toHaveBeenCalled();
  });

  it('should split the refund into price and tax where tax is added on top', async () => {
    const { executor, feeds } = setup(undefined, salesTaxOrder());

    await executor.executeRefund(command({ externalOrderId: '111-1', amount: '11.00', currency: 'USD' }));

    expect(feeds.uploadFeedDocument.mock.calls[0][0]).toContain('111-1\tI1\tCustomerReturn\tUSD\t10.00\t1.00\t0.00\t0.00');
  });

  it('should write a currency with no minor unit without decimals', async () => {
    const jpy = (amount: string): { amount: string; currencyCode: string } => ({ amount, currencyCode: 'JPY' });
    const yenOrder = {
      orderId: '503-1',
      salesChannel: { channelName: 'Amazon.co.jp', marketplaceId: 'A1VC38T7YXB528' },
      fulfillment: { fulfilledBy: 'MERCHANT' },
      proceeds: { grandTotal: jpy('1500') },
      orderItems: [
        {
          orderItemId: 'I1',
          quantityOrdered: 1,
          product: { sellerSku: 'MUG', price: { unitPrice: jpy('1500') } },
          proceeds: { breakdowns: [{ type: 'ITEM', subtotal: jpy('1500') }] },
        },
      ],
    } as unknown as AmazonOrder;
    const { executor, feeds } = setup(undefined, yenOrder);

    await executor.executeRefund(command({ externalOrderId: '503-1', amount: '1000', currency: 'JPY' }));

    expect(feeds.uploadFeedDocument.mock.calls[0][0]).toContain('503-1\tI1\tCustomerReturn\tJPY\t1000\t0\t0\t0');
  });
});
