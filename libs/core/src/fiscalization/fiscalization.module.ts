/**
 * Fiscalization Module (core)
 *
 * NestJS module for the fiscalization bounded context. Wires the
 * `fiscal_registration_records` ORM entity into TypeORM, binds the repository to
 * its port token, and provides `FiscalRegistrationService`.
 *
 * No `FiscalizationPort` binding lives here: adapters are resolved per
 * connection through the integrations registry under the `'Fiscalization'`
 * capability, so `IntegrationsModule` is imported for the token the service
 * depends on.
 *
 * `InvoicingModule` is imported for `INVOICE_SERVICE_TOKEN` (the cross-KIND
 * blocking-invoice read, #2157) and the `invoiceIssueLockKey` /
 * `INVOICE_ISSUE_LOCK_TTL_MS` lock constants; `SyncModule` for `SYNC_LOCK_TOKEN`
 * (the SAME per-order lock `InvoiceService.issueInvoice` takes). This is a
 * ONE-WAY edge — `InvoicingModule` does NOT import `FiscalizationModule` back
 * (its own cross-KIND read is resolved lazily via `ModuleRef`, see
 * `InvoiceService.resolveFiscalRegistrationService`), so no module-level cycle
 * is created. `InvoicingModule` does not reference fiscalization; `SyncModule`
 * does not reference either.
 *
 * @module libs/core/src/fiscalization
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { InvoicingModule } from '@openlinker/core/invoicing';
import { SyncModule } from '@openlinker/core/sync';

import { FiscalRegistrationService } from './application/services/fiscal-registration.service';
import { FiscalRegistrationRecordOrmEntity } from './infrastructure/persistence/entities/fiscal-registration-record.orm-entity';
import { FiscalRegistrationRecordRepository } from './infrastructure/persistence/repositories/fiscal-registration-record.repository';
import {
  FISCAL_REGISTRATION_RECORD_REPOSITORY_TOKEN,
  FISCAL_REGISTRATION_SERVICE_TOKEN,
} from './fiscalization.tokens';

// No token re-export here: `fiscalization.tokens.ts` plus the barrel's
// `export *` is the single publication path (engineering standards § Symbol DI
// Token Re-export Convention), so a new token cannot land on one surface and
// miss the other.

@Module({
  imports: [
    TypeOrmModule.forFeature([FiscalRegistrationRecordOrmEntity]),
    IntegrationsModule,
    InvoicingModule,
    SyncModule,
  ],
  providers: [
    FiscalRegistrationRecordRepository,
    {
      provide: FISCAL_REGISTRATION_RECORD_REPOSITORY_TOKEN,
      useExisting: FiscalRegistrationRecordRepository,
    },
    FiscalRegistrationService,
    {
      provide: FISCAL_REGISTRATION_SERVICE_TOKEN,
      useExisting: FiscalRegistrationService,
    },
  ],
  exports: [FISCAL_REGISTRATION_RECORD_REPOSITORY_TOKEN, FISCAL_REGISTRATION_SERVICE_TOKEN],
})
export class FiscalizationModule {}
