/**
 * Order Hold Projection Reconcile Service — unit tests (#2340)
 *
 * @module libs/core/src/orders/application/services/__tests__
 */
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
      { ifCurrentlyIs: null }
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
