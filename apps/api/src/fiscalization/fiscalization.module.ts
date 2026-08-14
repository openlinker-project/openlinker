/**
 * Fiscalization API Module (#1908)
 *
 * NestJS module for the fiscalization HTTP surface. Named `FiscalizationApiModule`
 * to avoid clashing with the core `FiscalizationModule` it imports (which supplies
 * `FISCAL_REGISTRATION_SERVICE_TOKEN`); `OrdersModule` supplies the order-record
 * service the controller composes the command from.
 *
 * @module apps/api/src/fiscalization
 */
import { Module } from '@nestjs/common';
import { FiscalizationModule } from '@openlinker/core/fiscalization';
import { OrdersModule } from '@openlinker/core/orders';

import { FiscalizationController } from './http/fiscalization.controller';

@Module({
  imports: [FiscalizationModule, OrdersModule],
  controllers: [FiscalizationController],
})
export class FiscalizationApiModule {}
