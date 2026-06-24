/**
 * Invoicing API Module (#1119)
 *
 * NestJS module for the invoicing HTTP surface. Named `InvoicingApiModule` to
 * avoid clashing with the core `InvoicingModule` (already imported in
 * app.module). Imports the core invoicing module (supplies INVOICE_SERVICE_TOKEN
 * + INVOICE_RECORD_REPOSITORY_TOKEN) and the core orders module (supplies
 * ORDER_RECORD_REPOSITORY_TOKEN for server-side Order loading).
 *
 * @module apps/api/src/invoicing
 */
import { Module } from '@nestjs/common';
import { InvoicingModule } from '@openlinker/core/invoicing';
import { OrdersModule } from '@openlinker/core/orders';
import { InvoicingController } from './http/invoicing.controller';

@Module({
  imports: [InvoicingModule, OrdersModule],
  controllers: [InvoicingController],
})
export class InvoicingApiModule {}
