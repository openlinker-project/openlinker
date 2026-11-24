/**
 * FulfillmentSaleDecrementReconcileService - unit spec (#3629)
 */
import { FulfillmentSaleDecrementReconcileService } from '../fulfillment-sale-decrement-reconcile.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('FulfillmentSaleDecrementReconcileService (#3629)', () => {
  const now = new Date('2026-09-29T12:00:00.000Z');
  let repository: { listWorksMissingSaleDecrementJob: jest.Mock };
  let service: FulfillmentSaleDecrementReconcileService;

  beforeEach(() => {
    repository = { listWorksMissingSaleDecrementJob: jest.fn().mockResolvedValue([]) };
    service = new FulfillmentSaleDecrementReconcileService(repository as never);
  });

  it('should derive the grace cutoff from the supplied instant', async () => {
    await service.listWorksMissingSaleDecrementJob({ limit: 25, graceMs: 10 * 60 * 1000, lookbackMs: 7 * DAY_MS, now });

    expect(repository.listWorksMissingSaleDecrementJob).toHaveBeenCalledWith({
      createdBefore: new Date('2026-09-29T11:50:00.000Z'),
      // The floor: one lookback before the same instant, so an old work whose
      // `sync_jobs` row was pruned can never look lost.
      createdAfter: new Date('2026-09-22T12:00:00.000Z'),
      limit: 25,
    });
  });

  it('should report each work under the producers dedupe key and the order source connection', async () => {
    repository.listWorksMissingSaleDecrementJob.mockResolvedValue([
      { workId: 'w-1', orderId: 'o-1', orderSourceConnectionId: 'src-1' },
    ]);

    const result = await service.listWorksMissingSaleDecrementJob({
      limit: 10,
      graceMs: 60_000,
      lookbackMs: DAY_MS,
      now,
    });

    expect(result.candidates).toEqual([
      {
        workId: 'w-1',
        orderId: 'o-1',
        connectionId: 'src-1',
        dedupeKey: 'inventory:sale-decrement:w-1',
      },
    ]);
  });

  it('should return no candidates when the repository finds none', async () => {
    const result = await service.listWorksMissingSaleDecrementJob({
      limit: 10,
      graceMs: 60_000,
      lookbackMs: DAY_MS,
      now,
    });

    expect(result.candidates).toEqual([]);
  });
});
