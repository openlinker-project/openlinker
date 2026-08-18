/**
 * Sales Documents Module (#2170)
 *
 * The first NestJS module this concern ships. Registers the three ORM
 * entities + repositories + the pure-evaluator-backed application service.
 * No cross-context imports in `imports: []` — this concern needs none of its
 * own (see the service's own doc comment on why the connection-capability
 * check lives at the API layer instead).
 *
 * @module libs/core/src/sales-documents
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalesDocumentRuleOrmEntity } from './infrastructure/persistence/entities/sales-document-rule.orm-entity';
import { SalesDocumentCountryDefaultOrmEntity } from './infrastructure/persistence/entities/sales-document-country-default.orm-entity';
import { SalesDocumentThresholdOrmEntity } from './infrastructure/persistence/entities/sales-document-threshold.orm-entity';
import { SalesDocumentRuleRepository } from './infrastructure/persistence/repositories/sales-document-rule.repository';
import { SalesDocumentCountryDefaultRepository } from './infrastructure/persistence/repositories/sales-document-country-default.repository';
import { SalesDocumentThresholdRepository } from './infrastructure/persistence/repositories/sales-document-threshold.repository';
import { SalesDocumentRulesService } from './application/services/sales-document-rules.service';
import {
  SALES_DOCUMENT_COUNTRY_DEFAULT_REPOSITORY_TOKEN,
  SALES_DOCUMENT_RULES_SERVICE_TOKEN,
  SALES_DOCUMENT_RULE_REPOSITORY_TOKEN,
  SALES_DOCUMENT_THRESHOLD_REPOSITORY_TOKEN,
} from './sales-documents.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SalesDocumentRuleOrmEntity,
      SalesDocumentCountryDefaultOrmEntity,
      SalesDocumentThresholdOrmEntity,
    ]),
  ],
  providers: [
    SalesDocumentRuleRepository,
    { provide: SALES_DOCUMENT_RULE_REPOSITORY_TOKEN, useExisting: SalesDocumentRuleRepository },
    SalesDocumentCountryDefaultRepository,
    {
      provide: SALES_DOCUMENT_COUNTRY_DEFAULT_REPOSITORY_TOKEN,
      useExisting: SalesDocumentCountryDefaultRepository,
    },
    SalesDocumentThresholdRepository,
    {
      provide: SALES_DOCUMENT_THRESHOLD_REPOSITORY_TOKEN,
      useExisting: SalesDocumentThresholdRepository,
    },
    SalesDocumentRulesService,
    { provide: SALES_DOCUMENT_RULES_SERVICE_TOKEN, useExisting: SalesDocumentRulesService },
  ],
  exports: [
    SALES_DOCUMENT_RULE_REPOSITORY_TOKEN,
    SALES_DOCUMENT_COUNTRY_DEFAULT_REPOSITORY_TOKEN,
    SALES_DOCUMENT_THRESHOLD_REPOSITORY_TOKEN,
    SALES_DOCUMENT_RULES_SERVICE_TOKEN,
  ],
})
export class SalesDocumentsModule {}
