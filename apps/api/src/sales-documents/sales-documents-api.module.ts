/**
 * Sales Documents API Module (#2170)
 *
 * NestJS module that wires the sales-document rule-engine HTTP layer. Imports
 * the core `SalesDocumentsModule` for service/repository providers, plus
 * `IntegrationsModule` so `SalesDocumentCapabilityGuardService` can resolve a
 * connection's adapter metadata for the capability check that deliberately
 * does NOT live inside the core module (see that guard's own doc comment).
 *
 * @module apps/api/src/sales-documents
 */
import { Module } from '@nestjs/common';
import { SalesDocumentsModule as CoreSalesDocumentsModule } from '@openlinker/core/sales-documents';
import { IntegrationsModule as CoreIntegrationsModule } from '@openlinker/core/integrations';
// #2518: market discovery is a read against the ORDERS store, reached through
// `IOrderRecordService`. CoreOrdersModule exports that token.
import { OrdersModule as CoreOrdersModule } from '@openlinker/core/orders';
import { SalesDocumentRulesController } from './http/sales-document-rules.controller';
import { SalesDocumentTemplatesController } from './http/sales-document-templates.controller';
import { SalesDocumentMarketsController } from './http/sales-document-markets.controller';
import { DeliveryLineSuggestionsController } from './http/delivery-line-suggestions.controller';
import { SalesDocumentSettingsController } from './http/sales-document-settings.controller';
import { DeliveryCountryFactsController } from './http/delivery-country-facts.controller';
// #3907: the facts controller verifies the connection through the API-layer
// connection service, which that module exports.
import { IntegrationsModule as ApiIntegrationsModule } from '../integrations/integrations.module';
import { SalesDocumentCapabilityGuardService } from './sales-document-capability-guard.service';
// #3583 batch issuing: CONNECTION_PORT_TOKEN (the connection's schedules and
// status) and JOB_ENQUEUE_TOKEN ("Run now" enqueues the run job).
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { SyncModule } from '@openlinker/core/sync';
import { SalesDocumentBatchController } from './http/sales-document-batch.controller';

@Module({
  imports: [
    CoreSalesDocumentsModule,
    CoreIntegrationsModule,
    CoreOrdersModule,
    ApiIntegrationsModule,
    IdentifierMappingModule,
    SyncModule,
  ],
  controllers: [
    SalesDocumentRulesController,
    SalesDocumentTemplatesController,
    SalesDocumentMarketsController,
    DeliveryLineSuggestionsController,
    DeliveryCountryFactsController,
    SalesDocumentSettingsController,
    SalesDocumentBatchController,
  ],
  providers: [SalesDocumentCapabilityGuardService],
})
export class SalesDocumentsApiModule {}
