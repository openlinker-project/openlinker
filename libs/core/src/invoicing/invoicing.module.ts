/**
 * Invoicing Module (core)
 *
 * NestJS module for the invoicing bounded context. Wires the `invoice_records`
 * ORM entity into TypeORM and binds `InvoiceRecordRepository` to its port token.
 * Issuance adapters are resolved per-connection through the integrations
 * registry (capability `'Invoicing'`), so no `InvoicingPort` binding lives here.
 *
 * @module libs/core/src/invoicing
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsModule } from '@openlinker/core/integrations';

import { InvoiceRecordOrmEntity } from './infrastructure/persistence/entities/invoice-record.orm-entity';
import { InvoiceRecordRepository } from './infrastructure/persistence/repositories/invoice-record.repository';
import { InvoiceService } from './application/services/invoice.service';
import {
  INVOICE_RECORD_REPOSITORY_TOKEN,
  INVOICE_SERVICE_TOKEN,
} from './invoicing.tokens';

export {
  INVOICE_RECORD_REPOSITORY_TOKEN,
  INVOICE_SERVICE_TOKEN,
} from './invoicing.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([InvoiceRecordOrmEntity]),
    // InvoiceService injects INTEGRATIONS_SERVICE_TOKEN to resolve the
    // 'Invoicing' capability adapter per-connection. IntegrationsModule exports
    // that token but is NOT @Global, so it must be imported (mirrors
    // ShippingModule). No cycle — integrations does not reference invoicing.
    IntegrationsModule,
  ],
  providers: [
    InvoiceRecordRepository,
    {
      provide: INVOICE_RECORD_REPOSITORY_TOKEN,
      useExisting: InvoiceRecordRepository,
    },
    InvoiceService,
    {
      provide: INVOICE_SERVICE_TOKEN,
      useExisting: InvoiceService,
    },
  ],
  exports: [INVOICE_RECORD_REPOSITORY_TOKEN, INVOICE_SERVICE_TOKEN],
})
export class InvoicingModule {}
