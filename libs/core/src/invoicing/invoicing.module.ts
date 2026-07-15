/**
 * Invoicing Module (core)
 *
 * NestJS module for the invoicing bounded context. Wires the `invoice_records`
 * ORM entity into TypeORM, binds `InvoiceRecordRepository` to its port token, and
 * provides the `InvoiceService` (record read + issuance orchestration). Issuance
 * adapters are resolved per-connection through the integrations registry
 * (capability `'Invoicing'`) — so `IntegrationsModule` is imported for the
 * `INTEGRATIONS_SERVICE_TOKEN` the service depends on, but no `InvoicingPort`
 * binding lives here.
 *
 * @module libs/core/src/invoicing
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { SyncModule } from '@openlinker/core/sync';

import { InvoiceService } from './application/services/invoice.service';
import { InvoiceRecordOrmEntity } from './infrastructure/persistence/entities/invoice-record.orm-entity';
import { InvoiceNumberingSeriesOrmEntity } from './infrastructure/persistence/entities/invoice-numbering-series.orm-entity';
import { InvoiceNumberingRouteOrmEntity } from './infrastructure/persistence/entities/invoice-numbering-route.orm-entity';
import { InvoiceRecordRepository } from './infrastructure/persistence/repositories/invoice-record.repository';
import { InvoiceNumberingSeriesRepository } from './infrastructure/persistence/repositories/invoice-numbering-series.repository';
import { AutoIssueTriggerService } from './application/services/auto-issue-trigger.service';
import { RegulatoryStatusReconciliationService } from './application/services/regulatory-status-reconciliation.service';
import { PaymentStatusRefreshService } from './application/services/payment-status-refresh.service';
import {
  INVOICE_RECORD_REPOSITORY_TOKEN,
  INVOICE_NUMBERING_SERIES_REPOSITORY_TOKEN,
  INVOICE_SERVICE_TOKEN,
  AUTO_ISSUE_TRIGGER_SERVICE_TOKEN,
  REGULATORY_STATUS_RECONCILIATION_SERVICE_TOKEN,
  PAYMENT_STATUS_REFRESH_SERVICE_TOKEN,
} from './invoicing.tokens';

export {
  INVOICE_RECORD_REPOSITORY_TOKEN,
  INVOICE_NUMBERING_SERIES_REPOSITORY_TOKEN,
  INVOICE_SERVICE_TOKEN,
  AUTO_ISSUE_TRIGGER_SERVICE_TOKEN,
  REGULATORY_STATUS_RECONCILIATION_SERVICE_TOKEN,
  PAYMENT_STATUS_REFRESH_SERVICE_TOKEN,
} from './invoicing.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InvoiceRecordOrmEntity,
      InvoiceNumberingSeriesOrmEntity,
      InvoiceNumberingRouteOrmEntity,
    ]),
    // InvoiceService injects INTEGRATIONS_SERVICE_TOKEN to resolve the
    // 'Invoicing' capability adapter per-connection. IntegrationsModule exports
    // that token but is NOT @Global, so it must be imported (mirrors
    // ShippingModule). No cycle — integrations does not reference invoicing.
    IntegrationsModule,
    // AutoIssueTriggerService (OL #1120) injects CONNECTION_PORT_TOKEN
    // (identifier-mapping) and SYNC_JOBS_SERVICE_TOKEN (sync). Neither module
    // references invoicing → no DI cycle (verified at runtime by the boot gate:
    // apps/worker/test/integration/invoicing-auto-issue-boot.int-spec.ts).
    IdentifierMappingModule,
    SyncModule,
  ],
  providers: [
    InvoiceRecordRepository,
    {
      provide: INVOICE_RECORD_REPOSITORY_TOKEN,
      useExisting: InvoiceRecordRepository,
    },
    InvoiceNumberingSeriesRepository,
    {
      provide: INVOICE_NUMBERING_SERIES_REPOSITORY_TOKEN,
      useExisting: InvoiceNumberingSeriesRepository,
    },
    InvoiceService,
    {
      provide: INVOICE_SERVICE_TOKEN,
      useExisting: InvoiceService,
    },
    AutoIssueTriggerService,
    {
      provide: AUTO_ISSUE_TRIGGER_SERVICE_TOKEN,
      useExisting: AutoIssueTriggerService,
    },
    RegulatoryStatusReconciliationService,
    {
      provide: REGULATORY_STATUS_RECONCILIATION_SERVICE_TOKEN,
      useExisting: RegulatoryStatusReconciliationService,
    },
    PaymentStatusRefreshService,
    {
      provide: PAYMENT_STATUS_REFRESH_SERVICE_TOKEN,
      useExisting: PaymentStatusRefreshService,
    },
  ],
  // Export BOTH the token and the provider so OrdersModule (which imports this
  // module) can inject the trigger service by token (F2/F3). The reconciliation
  // token is exported so the worker's SyncWorkerModule can inject the service
  // into RegulatoryStatusReconcileHandler — providing-without-exporting would
  // fail the worker's DI at boot (#1121 plan decision #12).
  exports: [
    INVOICE_RECORD_REPOSITORY_TOKEN,
    INVOICE_NUMBERING_SERIES_REPOSITORY_TOKEN,
    INVOICE_SERVICE_TOKEN,
    AUTO_ISSUE_TRIGGER_SERVICE_TOKEN,
    AutoIssueTriggerService,
    REGULATORY_STATUS_RECONCILIATION_SERVICE_TOKEN,
    // Exported so the worker's SyncWorkerModule can inject the service into
    // PaymentStatusRefreshHandler (#1354) — same reason as the reconciliation token.
    PAYMENT_STATUS_REFRESH_SERVICE_TOKEN,
  ],
})
export class InvoicingModule {}
