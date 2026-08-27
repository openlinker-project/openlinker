/**
 * Order Hold Projection Reconcile Service — unit tests (#2340)
 *
 * @module libs/core/src/orders/application/services/__tests__
 */
import { HoldProjectionWriteUnreadableError } from '../../../domain/exceptions/hold-projection-write-unreadable.error';
import type { OrderHoldProjectionRepositoryPort } from '../../../domain/ports/order-hold-projection-repository.port';
import type { HoldProjectionDivergence } from '../../../domain/types/order-hold-projection.types';
import { OrderHoldProjectionReconcileService } from '../order-hold-projection-reconcile.service';

function divergence(
  overrides: Partial<HoldProjectionDivergence> = {}
): HoldProjectionDivergence {
  return {
    internalOrderId: 'ol_order_1',
    expectedReason: 'stock-shortfall',
    projectedReason: null,
    ...overrides,
  };
}

describe('OrderHoldProjectionReconcileService', () => {
  let projection: jest.Mocked<OrderHoldProjectionRepositoryPort>;
  let service: OrderHoldProjectionReconcileService;

  beforeEach(() => {
    projection = {
      setActiveHoldReason: jest.fn().mockResolvedValue(true),
      findDivergentProjections: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<OrderHoldProjectionRepositoryPort>;
    service = new OrderHoldProjectionReconcileService(projection);
  });

  it('should report an empty page when nothing diverges', async () => {
    await expect(service.runPage(500)).resolves.toEqual({
      examined: 0,
      repaired: 0,
      superseded: 0,
      failed: 0,
    });
  });

  it('should repair a missed place write, carrying the observed value as the CAS witness', async () => {
    projection.findDivergentProjections.mockResolvedValue([divergence()]);

    const result = await service.runPage(500);

    expect(projection.setActiveHoldReason).toHaveBeenCalledWith(
      'ol_order_1',
      'stock-shortfall',
      { ifCurrentlyIs: null, requireNoOpenHold: false }
    );
    expect(result).toMatchObject({ examined: 1, repaired: 1 });
  });

  it('should repair a missed release clear by writing null', async () => {
    projection.findDivergentProjections.mockResolvedValue([
      divergence({ expectedReason: null, projectedReason: 'operator' }),
    ]);

    await service.runPage(500);

    expect(projection.setActiveHoldReason).toHaveBeenCalledWith('ol_order_1', null, {
      ifCurrentlyIs: 'operator',
      requireNoOpenHold: true,
    });
  });

  it('should condition the CLEAR arm on the authority, not on the witnessed value', async () => {
    // The race the value-witness alone could not close: the pass witnesses a
    // missed clear at 'operator', and a genuinely NEW 'operator' hold is placed
    // before the repair runs. `ifCurrentlyIs: 'operator'` STILL matches — it
    // compares a value, not a version — so the clear would erase a live hold
    // and leave the order reading un-held for up to an hour.
    //
    // `requireNoOpenHold` moves that check into the statement, where
    // `order_holds` decides it. Asserted at the port because that is where the
    // guarantee lives; `order-hold-projection.int-spec.ts` proves the SQL arm
    // actually withholds the write against real Postgres.
    projection.findDivergentProjections.mockResolvedValue([
      divergence({ expectedReason: null, projectedReason: 'operator' }),
    ]);

    await service.runPage(500);

    const options = projection.setActiveHoldReason.mock.calls[0][2];
    expect(options).toEqual({ ifCurrentlyIs: 'operator', requireNoOpenHold: true });
  });

  it('should NOT ask for the authority guard when writing a reason', async () => {
    // Setting a reason is already guarded by the open hold the pass just read;
    // demanding "no open hold" there would make every set-arm repair a no-op.
    projection.findDivergentProjections.mockResolvedValue([divergence()]);

    await service.runPage(500);

    const options = projection.setActiveHoldReason.mock.calls[0][2] as {
      requireNoOpenHold?: boolean;
    };
    expect(options.requireNoOpenHold).toBe(false);
  });

  it('should count an unreadable driver result as failed, never as superseded', async () => {
    // The two have DIFFERENT remedies and the counter is this pass's only
    // observability, so "we do not know what happened" must not be reported as
    // "a peer beat us to it".
    projection.findDivergentProjections.mockResolvedValue([divergence()]);
    projection.setActiveHoldReason.mockRejectedValue(
      new HoldProjectionWriteUnreadableError('ol_order_1')
    );

    await expect(service.runPage(500)).resolves.toEqual({
      examined: 1,
      repaired: 0,
      superseded: 0,
      failed: 1,
    });
  });

  it('should count a lost compare-and-set as superseded, never as a repair or a failure', async () => {
    // A peer (place/release) wrote between the read and the repair. That is a
    // normal outcome — the authority won, which is the whole point of the CAS.
    projection.findDivergentProjections.mockResolvedValue([divergence()]);
    projection.setActiveHoldReason.mockResolvedValue(false);

    await expect(service.runPage(500)).resolves.toEqual({
      examined: 1,
      repaired: 0,
      superseded: 1,
      failed: 0,
    });
  });

  it('should not retry a lost compare-and-set within the same page', async () => {
    projection.findDivergentProjections.mockResolvedValue([divergence()]);
    projection.setActiveHoldReason.mockResolvedValue(false);

    await service.runPage(500);

    // A retry would re-read the same stale witness; the next tick re-examines.
    expect(projection.setActiveHoldReason).toHaveBeenCalledTimes(1);
  });

  it('should keep repairing the rest of the page when one row throws', async () => {
    // The page is LIMIT n ordered by id, so an aborting throw would starve every
    // row behind the poison one permanently.
    projection.findDivergentProjections.mockResolvedValue([
      divergence({ internalOrderId: 'ol_order_poison' }),
      divergence({ internalOrderId: 'ol_order_2' }),
    ]);
    projection.setActiveHoldReason
      .mockRejectedValueOnce(new Error('deadlock'))
      .mockResolvedValueOnce(true);

    await expect(service.runPage(500)).resolves.toEqual({
      examined: 2,
      repaired: 1,
      superseded: 0,
      failed: 1,
    });
  });

  it('should page by the requested budget', async () => {
    await service.runPage(42);
    expect(projection.findDivergentProjections).toHaveBeenCalledWith(42);
  });
});
