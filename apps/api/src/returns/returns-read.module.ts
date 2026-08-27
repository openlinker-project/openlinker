/**
 * Returns Read API Module
 *
 * REST reads over the return aggregate (#2334) — the sibling of
 * `ReturnActionsApiModule` (#2333), which owns the one return WRITE.
 *
 * Two modules on one route prefix rather than one, deliberately: the write
 * carries `@Roles('admin', 'operator')` and these reads do not, and the two
 * inject different services. See `ReturnsController`'s docblock for the full
 * argument. Both import the same `ReturnsModule`, so no provider is duplicated.
 *
 * @module apps/api/src/returns
 */
import { Module } from '@nestjs/common';
import { OrdersModule } from '@openlinker/core/orders';
import { ReturnsModule } from '@openlinker/core/returns';
import { ReturnsController } from './http/returns.controller';

@Module({
  // #2382 — a NEW MODULE EDGE, named as one rather than described as "a
  // projection", because a reader auditing module boundaries greps for edges.
  // The detail read now carries the return's linked refunds and the order's
  // currency, both owned by `orders`. Acyclic and interface-layer: `OrdersModule`
  // does not import `ReturnsModule`, and the sibling write module has imported it
  // since #2376 with the same argument in its own docblock.
  imports: [ReturnsModule, OrdersModule],
  controllers: [ReturnsController],
})
export class ReturnsReadApiModule {}
