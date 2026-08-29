/**
 * Return Actions API Module
 *
 * Every return WRITE. A sibling of `CatalogTrustApiModule` — the same thin
 * composition over a core context that owns its own persistence.
 *
 * It carried exactly one route when it was written (`decline`, #2333); #2376
 * added `ReturnWritesController` beside it with nine more — record, authorize,
 * match-order, the three per-line custody acts, mark-stock-handled, refund and
 * the correction proposal. Two controllers rather than one because they were
 * built a wave apart and their route sets are independently reviewable; one
 * module because they share this module's imports and auth posture exactly.
 *
 * Named for the ACTIONS half deliberately: the returns read API (#2334) ships
 * concurrently and brings its own module into this directory. Keeping the two
 * files and class names distinct makes that a textual merge.
 *
 * @module apps/api/src/returns
 */
import { Module } from '@nestjs/common';
import { OrdersModule } from '@openlinker/core/orders';
import { ReturnsModule } from '@openlinker/core/returns';
import { ReturnActionsController } from './http/return-actions.controller';
import { ReturnWritesController } from './http/return-writes.controller';

@Module({
  imports: [
    ReturnsModule,
    // #2376: the refund route writes the linked `RefundRecord` itself, through
    // `IOrderRefundService` — that is the #2100 report-don't-persist seam, and
    // it is exactly what keeps `OrdersModule` OUT of core's `ReturnsModule`.
    //
    // This edge is INTERFACE-LAYER and acyclic: `OrdersModule` does not import
    // `ReturnsModule`, and eight other `apps/api` modules already import it.
    // It superficially resembles the core rule it does not breach — that rule
    // forbids `OrdersModule` in **`ReturnsModule.imports`**, and `apps/api` sits
    // above both.
    OrdersModule,
  ],
  controllers: [ReturnActionsController, ReturnWritesController],
})
export class ReturnActionsApiModule {}
