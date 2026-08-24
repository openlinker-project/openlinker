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
import { SalesDocumentRulesController } from './http/sales-document-rules.controller';
import { SalesDocumentTemplatesController } from './http/sales-document-templates.controller';
import { SalesDocumentCapabilityGuardService } from './sales-document-capability-guard.service';

@Module({
  imports: [CoreSalesDocumentsModule, CoreIntegrationsModule],
  controllers: [SalesDocumentRulesController, SalesDocumentTemplatesController],
  providers: [SalesDocumentCapabilityGuardService],
})
export class SalesDocumentsApiModule {}
