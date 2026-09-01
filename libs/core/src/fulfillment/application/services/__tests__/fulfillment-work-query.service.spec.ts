/**
 * `FulfillmentWorkQueryService` — the blocking-rejection read (#2408)
 *
 * The `not-blocked-by-reject` routing filter is the rejection model's first
 * consumer, and this read is the only thing that turns rejection ROWS into the
 * connection ids the filter eliminates on. Without a spec here the filter's own
 * spec proves nothing about it: that one feeds the filter a fake set, so a read
 * that returned `[]` for every order would leave every assertion in the tree
 * green while the filter silently never matched — the same defect class as a
 * declared-but-inert vocabulary member, one level further from the surface.
 */
import { FulfillmentWorkQueryService } from '../fulfillment-work-query.service';
import type { FulfillmentWorkRepositoryPort } from '../../../domain/ports/fulfillment-work-repository.port';

const work = (id: string): { id: string } => ({ id });

const rejection = (connectionId: string): { connectionId: string; blocking: boolean } => ({
  connectionId,
  blocking: true,
});

describe('FulfillmentWorkQueryService.listBlockingRejectionConnectionIds', () => {
  let repository: {
    findByOrderId: jest.Mock;
    listBlockingRejections: jest.Mock;
  };
  let service: FulfillmentWorkQueryService;

  beforeEach(() => {
    repository = {
      findByOrderId: jest.fn().mockResolvedValue([]),
      listBlockingRejections: jest.fn().mockResolvedValue([]),
    };
    service = new FulfillmentWorkQueryService(repository as unknown as FulfillmentWorkRepositoryPort);
  });

  it('should report the connection that rejected this order with a blocking reason', async () => {
    repository.findByOrderId.mockResolvedValue([work('work-1')]);
    repository.listBlockingRejections.mockResolvedValue([rejection('conn-a')]);

    await expect(service.listBlockingRejectionConnectionIds('ol_order_1')).resolves.toEqual(['conn-a']);
    expect(repository.listBlockingRejections).toHaveBeenCalledWith('work-1');
  });

  it('should report an empty set when the order has no work at all', async () => {
    await expect(service.listBlockingRejectionConnectionIds('ol_order_1')).resolves.toEqual([]);
    // An order nobody has routed yet must not cost a rejection read.
    expect(repository.listBlockingRejections).not.toHaveBeenCalled();
  });

  it('should report an empty set when the work carries no blocking rejection', async () => {
    repository.findByOrderId.mockResolvedValue([work('work-1')]);

    await expect(service.listBlockingRejectionConnectionIds('ol_order_1')).resolves.toEqual([]);
  });

  it('should union the rejecters across every work covering the order', async () => {
    // An exclusion is a SET (`fulfillment-work-rejection.types.ts`): holder A
    // refuses, the router tries B, B refuses too — and a split order carries
    // more than one work, so reading only the first would quietly re-offer the
    // order to a holder that already said no.
    repository.findByOrderId.mockResolvedValue([work('work-1'), work('work-2')]);
    repository.listBlockingRejections.mockImplementation(async (workId: string) =>
      await Promise.resolve(workId === 'work-1' ? [rejection('conn-a')] : [rejection('conn-b')])
    );

    const result = await service.listBlockingRejectionConnectionIds('ol_order_1');
    expect([...result].sort()).toEqual(['conn-a', 'conn-b']);
  });

  it('should report a connection once even when it rejected several works', async () => {
    repository.findByOrderId.mockResolvedValue([work('work-1'), work('work-2')]);
    repository.listBlockingRejections.mockResolvedValue([rejection('conn-a')]);

    await expect(service.listBlockingRejectionConnectionIds('ol_order_1')).resolves.toEqual(['conn-a']);
  });
});
