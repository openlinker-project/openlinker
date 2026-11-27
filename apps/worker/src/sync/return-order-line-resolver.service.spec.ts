/**
 * Return order-line resolver spec (E-14)
 *
 * Only the E-14 report is covered here: an ingested return is never refused, but
 * an unresolved line on an order with an edit-removed line is surfaced.
 */
import { Logger } from '@openlinker/shared/logging';
import { ReturnOrderLineResolverService } from './return-order-line-resolver.service';

describe('ReturnOrderLineResolverService', () => {
  it('should warn that an unresolved return may name a line removed by an order edit (E-14)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const returns = {
      getReturn: jest.fn().mockResolvedValue({ internalOrderId: 'ol_order_1' }),
      resolveOrderLinesForReturn: jest.fn().mockResolvedValue({
        skipped: null,
        resolved: 0,
        alreadyResolved: 0,
        unresolved: { 'no-candidate': 1 },
      }),
    };
    const orderRecords = {
      getOrderRecord: jest.fn().mockResolvedValue({
        orderItems: [{ id: 'l2' }],
        orderSnapshot: { items: [{ id: 'l2', sku: 'B' }] },
        channelSnapshot: {
          items: [
            { id: 'l1', sku: 'A' },
            { id: 'l2', sku: 'B' },
          ],
        },
      }),
    };
    const service = new ReturnOrderLineResolverService(returns as never, orderRecords as never);

    const summary = await service.resolveForReturn('ret-1');

    expect(summary).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('removed by an OpenLinker edit (A)'));
    warn.mockRestore();
  });
});
