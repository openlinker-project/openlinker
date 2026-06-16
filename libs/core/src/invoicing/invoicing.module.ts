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

import { InvoiceRecordOrmEntity } from './infrastructure/persistence/entities/invoice-record.orm-entity';
import { InvoiceRecordRepository } from './infrastructure/persistence/repositories/invoice-record.repository';
import { INVOICE_RECORD_REPOSITORY_TOKEN } from './invoicing.tokens';

export { INVOICE_RECORD_REPOSITORY_TOKEN } from './invoicing.tokens';

@Module({
  imports: [TypeOrmModule.forFeature([InvoiceRecordOrmEntity])],
  providers: [
    InvoiceRecordRepository,
    {
      provide: INVOICE_RECORD_REPOSITORY_TOKEN,
      useExisting: InvoiceRecordRepository,
    },
  ],
  exports: [INVOICE_RECORD_REPOSITORY_TOKEN],
})
export class InvoicingModule {}
