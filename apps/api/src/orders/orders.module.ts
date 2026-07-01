/**
 * Orders API Module
 *
 * NestJS module for order record read API endpoints. Imports core orders
 * module and registers the orders controller.
 *
 * @module apps/api/src/orders
 */
import { Module } from '@nestjs/common';
import { OrdersModule as CoreOrdersModule } from '@openlinker/core/orders';
import { InvoicingModule as CoreInvoicingModule } from '@openlinker/core/invoicing';
import { OrdersController } from './http/orders.controller';

@Module({
  imports: [CoreOrdersModule, CoreInvoicingModule],
  controllers: [OrdersController],
})
export class OrdersModule {}
