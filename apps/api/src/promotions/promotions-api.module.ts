/**
 * Promotions API Module (#3935)
 *
 * REST surface for promotions: the CRUD/reorder/dry-run controller and the
 * order-scoped gift-attention reads. It imports `PromotionsModule` and
 * `OrdersModule`; an `apps/api` module is a leaf of the graph, so composing the
 * two here closes no cycle inside `libs/core` (where `orders` already depends on
 * `promotions`).
 *
 * @module apps/api/src/promotions
 */
import { Module } from '@nestjs/common';
import { CustomersModule } from '@openlinker/core/customers';
import { OrdersModule } from '@openlinker/core/orders';
import { PromotionsModule } from '@openlinker/core/promotions';

import { GiftAttentionController } from './http/gift-attention.controller';
import { PromotionsController } from './http/promotions.controller';

@Module({
  imports: [PromotionsModule, OrdersModule, CustomersModule],
  controllers: [PromotionsController, GiftAttentionController],
})
export class PromotionsApiModule {}
