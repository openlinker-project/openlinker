/**
 * Order Hold Projection Reconcile Service (#2340, DESIGN §6.3)
 *
 * Repairs `order_records.activeHoldReason` against `order_holds`. The write in
 * `OrderHoldService` is best-effort by design, so this pass is what makes the
 * cache trustworthy rather than merely usually-right.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderHoldProjectionReconcileService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { OrderHoldProjectionRepositoryPort } from '../../domain/ports/order-hold-projection-repository.port';
import type {
  HoldProjectionDivergence,
  HoldProjectionReconcileResult,
} from '../../domain/types/order-hold-projection.types';
import { ORDER_HOLD_PROJECTION_REPOSITORY_TOKEN } from '../../orders.tokens';
import type { IOrderHoldProjectionReconcileService } from '../interfaces/order-hold-projection-reconcile.service.interface';

@Injectable()
export class OrderHoldProjectionReconcileService
  implements IOrderHoldProjectionReconcileService
{
  private readonly logger = new Logger(OrderHoldProjectionReconcileService.name);

  constructor(
    @Inject(ORDER_HOLD_PROJECTION_REPOSITORY_TOKEN)
    private readonly projection: OrderHoldProjectionRepositoryPort
  ) {}

  async runPage(limit: number): Promise<HoldProjectionReconcileResult> {
    const divergences = await this.projection.findDivergentProjections(limit);

    let repaired = 0;
    let superseded = 0;
    let failed = 0;

    for (const divergence of divergences) {
      const outcome = await this.repairOne(divergence);
      if (outcome === 'repaired') {
        repaired += 1;
      } else if (outcome === 'superseded') {
        superseded += 1;
      } else {
        failed += 1;
      }
    }

    return { examined: divergences.length, repaired, superseded, failed };
  }

  /**
   * Repair one row, reporting rather than throwing.
   *
   * **The per-row catch is what keeps a poison row from parking the frontier.**
   * The page is `LIMIT n` ordered by `internalOrderId`, so a throw that aborted
   * the page would starve every row behind it permanently — the failure mode
   * #2330's returns sweep designs around. Caught, a poison row costs one repair
   * per tick instead of the whole pass.
   *
   * The write is a compare-and-set against the value this pass OBSERVED, so a
   * `release()` committing between the read and here wins and is counted
   * `superseded`. That is a normal outcome, not an error, and it is deliberately
   * NOT retried in-loop: a retry would re-read the same stale witness. The next
   * tick re-examines the row if it still diverges.
   *
   * **A value witness is not enough on the CLEAR arm**, because a new hold can
   * carry the same reason the stale projection already shows — so that arm adds
   * `requireNoOpenHold` and lets the database evaluate `order_holds` in the same
   * statement. `superseded` therefore means "something else got there first",
   * and never "we erased a live hold".
   *
   * `failed` covers a throw, which now includes
   * `HoldProjectionWriteUnreadableError` — an outcome nobody can read, kept
   * distinct from `superseded` because the two have different remedies.
   */
  private async repairOne(
    divergence: HoldProjectionDivergence
  ): Promise<'repaired' | 'superseded' | 'failed'> {
    try {
      const changed = await this.projection.setActiveHoldReason(
        divergence.internalOrderId,
        divergence.expectedReason,
        {
          ifCurrentlyIs: divergence.projectedReason,
          // The CLEAR arm is additionally conditioned on the AUTHORITY, not on
          // the value this pass witnessed — see the option's docblock. A
          // same-reason hold placed between the read and here otherwise slipped
          // through the compare-and-set and had its projection erased.
          requireNoOpenHold: divergence.expectedReason === null,
        }
      );

      if (changed) {
        this.logger.log(
          `order_hold_projection_repaired for order ${divergence.internalOrderId}: ` +
            `'${String(divergence.projectedReason)}' -> '${String(divergence.expectedReason)}'`
        );
        return 'repaired';
      }
      return 'superseded';
    } catch (error) {
      this.logger.warn(
        `order_hold_projection_repair_failed for order ${divergence.internalOrderId}: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
      return 'failed';
    }
  }
}
