/**
 * Invoicing API Module (#1119)
 *
 * NestJS module for the invoicing HTTP surface. Named `InvoicingApiModule` to
 * avoid clashing with the core `InvoicingModule` (already imported in
 * app.module). Imports the core invoicing module (supplies INVOICE_SERVICE_TOKEN
 * + INVOICE_RECORD_REPOSITORY_TOKEN) and the core orders module (supplies
 * ORDER_RECORD_REPOSITORY_TOKEN for server-side Order loading).
 *
 * Also imports the core + API `IntegrationsModule`s so that
 * `getCapabilityAdapter('Invoicing')` resolves the per-connection KSeF adapter
 * at runtime for the UPO download endpoint (#1224, epic #1142 C15). Mirrors
 * `apps/api/src/content/content.module.ts`.
 *
 * @module apps/api/src/invoicing
 */
import { Module } from '@nestjs/common';
import { IntegrationsModule as CoreIntegrationsModule } from '@openlinker/core/integrations';
import { InvoicingModule } from '@openlinker/core/invoicing';
import { OrdersModule } from '@openlinker/core/orders';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { IntegrationsModule } from '../integrations/integrations.module';
import { InvoicingController } from './http/invoicing.controller';

@Module({
  // IdentifierMappingModule supplies CONNECTION_PORT_TOKEN so the controller can
  // read the connection's `config.invoicing.shippingLineName` (#1562).
  imports: [
    InvoicingModule,
    OrdersModule,
    CoreIntegrationsModule,
    IntegrationsModule,
    IdentifierMappingModule,
  ],
  controllers: [InvoicingController],
})
export class InvoicingApiModule {}
