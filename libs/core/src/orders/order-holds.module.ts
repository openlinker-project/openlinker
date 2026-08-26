/**
 * Order Holds Module (#2338, DESIGN §6.3)
 *
 * A **leaf** module inside the `orders` context: it imports nothing but its own
 * `TypeOrmModule.forFeature`, and it is what a consumer imports to reach the
 * hold record.
 *
 * ## Why this is not simply part of `OrdersModule`
 *
 * `OrdersModule` imports Integrations, IdentifierMapping, Sync, Products,
 * Mappings, Customers, Invoicing and Currency. #2339's `OrderHoldService` needs
 * one repository from this context; making it import that graph would couple the
 * hold seam to eight siblings it has no business knowing. The precedent is
 * `OrderChangesModule` one file over, and behind it
 * `@openlinker/core/listings/services`: one context, more than one module, split
 * so a consumer takes only the seam it needs.
 *
 * ## Who imports it
 *
 * `OrdersModule` imports it (and re-exports the token), so the repository is
 * reachable from the app graph today — which is also what lets
 * `order-holds.int-spec.ts` resolve it, since `apps/**` may not deep-import
 * `@openlinker/core/*` sub-paths to reach the class directly.
 *
 * That edge is DIRECTIONAL and costs this module nothing: importing a leaf into
 * a fat module does not give the leaf the fat module's dependencies. #2339's
 * `OrderHoldService` therefore still imports THIS module rather than
 * `OrdersModule`, and keeps the narrow seam the split exists for.
 *
 * @module libs/core/src/orders
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderHoldOrmEntity } from './infrastructure/persistence/entities/order-hold.orm-entity';
import { OrderHoldRepository } from './infrastructure/persistence/repositories/order-hold.repository';
import { ORDER_HOLD_REPOSITORY_TOKEN } from './orders.tokens';

@Module({
  imports: [TypeOrmModule.forFeature([OrderHoldOrmEntity])],
  providers: [
    OrderHoldRepository,
    { provide: ORDER_HOLD_REPOSITORY_TOKEN, useExisting: OrderHoldRepository },
  ],
  exports: [ORDER_HOLD_REPOSITORY_TOKEN],
})
export class OrderHoldsModule {}
