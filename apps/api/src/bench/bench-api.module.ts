/**
 * Bench API Module (#2416, `W3b-3`)
 *
 * The HTTP surface for the pack bench's work list.
 *
 * The composition lives here rather than in `libs/core` because the row joins
 * `fulfillment` to `orders`, and `libs/core/src/fulfillment` is a registered
 * zero-sibling-edge leaf that may not read `orders` (ADR-053) — see
 * `BenchWorkService`. The `FulfillmentAuthorityApiModule` (#2353) shape.
 *
 * Named `BenchApiModule` for the reason `FulfillmentApiModule` states: an
 * unqualified `BenchModule` would collide with any future core-side name and is
 * a trap for the next reader.
 *
 * @module apps/api/src/bench
 */
import { Module } from '@nestjs/common';
import { FulfillmentModule as CoreFulfillmentModule } from '@openlinker/core/fulfillment';
import { OrdersModule } from '@openlinker/core/orders';

import { IntegrationsModule } from '../integrations/integrations.module';
import { BENCH_WORK_SERVICE_TOKEN } from './application/interfaces/bench-work.service.interface';
import { BenchWorkService } from './application/services/bench-work.service';
import { BenchWorkController } from './http/bench-work.controller';

@Module({
  imports: [CoreFulfillmentModule, OrdersModule, IntegrationsModule],
  controllers: [BenchWorkController],
  providers: [
    BenchWorkService,
    { provide: BENCH_WORK_SERVICE_TOKEN, useExisting: BenchWorkService },
  ],
})
export class BenchApiModule {}
