/**
 * Order Changes Module (#2333, ADR-044)
 *
 * A **leaf** module inside the `orders` context: it imports nothing but its own
 * `TypeOrmModule.forFeature`, and it is what a sibling context imports to reach
 * the ADR-044 proposal record.
 *
 * ## Why this is not simply part of `OrdersModule`
 *
 * `OrdersModule` imports Integrations, IdentifierMapping, Sync, Products,
 * Mappings, Customers, Invoicing and Currency. `ReturnsModule` needs one
 * repository from this context; making it import that graph would couple the
 * returns context to seven siblings it has no business knowing, and would turn
 * any future `orders -> returns` edge into a real cycle rather than a documented
 * rule. The precedent is `@openlinker/core/listings/services`: one context, more
 * than one module, split so a consumer takes only the seam it needs.
 *
 * The files still live under `libs/core/src/orders/` because ADR-044 is an
 * *order*-mutation decision — the split is a DI-graph decision, not a
 * context-ownership one.
 *
 * Note the module-load edge `returns -> orders` already existed before this
 * change (`ReturnIngestionService` value-imports `isReturnSourceReader` from the
 * main orders barrel); this adds no new one.
 *
 * @module libs/core/src/orders
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderChangeService } from './application/services/order-change.service';
import { OrderChangeOrmEntity } from './infrastructure/persistence/entities/order-change.orm-entity';
import { OrderChangeRepository } from './infrastructure/persistence/repositories/order-change.repository';
import {
  ORDER_CHANGE_REPOSITORY_TOKEN,
  ORDER_CHANGE_SERVICE_TOKEN,
} from './orders.tokens';

@Module({
  imports: [TypeOrmModule.forFeature([OrderChangeOrmEntity])],
  providers: [
    OrderChangeRepository,
    { provide: ORDER_CHANGE_REPOSITORY_TOKEN, useExisting: OrderChangeRepository },
    OrderChangeService,
    { provide: ORDER_CHANGE_SERVICE_TOKEN, useExisting: OrderChangeService },
  ],
  exports: [ORDER_CHANGE_REPOSITORY_TOKEN, ORDER_CHANGE_SERVICE_TOKEN],
})
export class OrderChangesModule {}
