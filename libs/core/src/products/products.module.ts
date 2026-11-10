/**
 * Products Module
 *
 * NestJS module for products functionality. Configures TypeORM entities,
 * repositories, and services. Exports the products service and ports
 * for use in other modules.
 *
 * @module libs/core/src/products
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductOrmEntity } from './infrastructure/persistence/entities/product.orm-entity';
import { ProductVariantOrmEntity } from './infrastructure/persistence/entities/product-variant.orm-entity';
import { ProductRepository } from './infrastructure/persistence/repositories/product.repository';
import { ProductVariantRepository } from './infrastructure/persistence/repositories/product-variant.repository';
import { ProductsService } from './application/services/products.service';
import { MasterProductSyncService } from './application/services/master-product-sync.service';
import { AutoMatchVariantOffersService } from './application/services/auto-match-variant-offers.service';
import { TaxRateJournalOrmEntity } from './infrastructure/persistence/entities/tax-rate-journal.orm-entity';
import { TaxRateJournalRepository } from './infrastructure/persistence/repositories/tax-rate-journal.repository';
import { TaxRateJournalService } from './application/services/tax-rate-journal.service';
import { MultipackConfirmationOrmEntity } from './infrastructure/persistence/entities/multipack-confirmation.orm-entity';
import { BundleDefinitionOrmEntity } from './infrastructure/persistence/entities/bundle-definition.orm-entity';
import { BundleDefinitionRepository } from './infrastructure/persistence/repositories/bundle-definition.repository';
import { BundleDefinitionService } from './application/services/bundle-definition.service';
import { BundleMasterSyncService } from './application/services/bundle-master-sync.service';
import {
  PRODUCT_REPOSITORY_TOKEN,
  PRODUCT_VARIANT_REPOSITORY_TOKEN,
  PRODUCTS_SERVICE_TOKEN,
  MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
  AUTO_MATCH_VARIANT_OFFERS_SERVICE_TOKEN,
  TAX_RATE_JOURNAL_REPOSITORY_TOKEN,
  TAX_RATE_JOURNAL_SERVICE_TOKEN,
  BUNDLE_DEFINITION_REPOSITORY_TOKEN,
  BUNDLE_DEFINITION_SERVICE_TOKEN,
  BUNDLE_MASTER_SYNC_SERVICE_TOKEN,
  BUNDLE_PRODUCT_CREATION_SERVICE_TOKEN,
} from './products.tokens';
import { BundleProductCreationService } from './application/services/bundle-product-creation.service';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { EventsModule } from '@openlinker/core/events';

// Re-export tokens for convenience
export {
  PRODUCT_REPOSITORY_TOKEN,
  PRODUCT_VARIANT_REPOSITORY_TOKEN,
  PRODUCTS_SERVICE_TOKEN,
  MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
} from './products.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductOrmEntity, ProductVariantOrmEntity, TaxRateJournalOrmEntity, BundleDefinitionOrmEntity, MultipackConfirmationOrmEntity]),
    IntegrationsModule,
    IdentifierMappingModule,
    EventsModule,
  ],
  providers: [
    // Provide classes directly first
    ProductRepository,
    ProductVariantRepository,
    ProductsService,
    MasterProductSyncService,
    AutoMatchVariantOffersService,
    TaxRateJournalRepository,
    TaxRateJournalService,
    BundleDefinitionRepository,
    BundleDefinitionService,
    BundleMasterSyncService,
    BundleProductCreationService,
    // Then provide token bindings using useExisting
    {
      provide: PRODUCT_REPOSITORY_TOKEN,
      useExisting: ProductRepository,
    },
    {
      provide: PRODUCT_VARIANT_REPOSITORY_TOKEN,
      useExisting: ProductVariantRepository,
    },
    {
      provide: PRODUCTS_SERVICE_TOKEN,
      useExisting: ProductsService,
    },
    {
      provide: MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
      useExisting: MasterProductSyncService,
    },
    {
      provide: AUTO_MATCH_VARIANT_OFFERS_SERVICE_TOKEN,
      useExisting: AutoMatchVariantOffersService,
    },
    {
      provide: TAX_RATE_JOURNAL_REPOSITORY_TOKEN,
      useExisting: TaxRateJournalRepository,
    },
    {
      provide: TAX_RATE_JOURNAL_SERVICE_TOKEN,
      useExisting: TaxRateJournalService,
    },
    {
      provide: BUNDLE_DEFINITION_REPOSITORY_TOKEN,
      useExisting: BundleDefinitionRepository,
    },
    {
      provide: BUNDLE_DEFINITION_SERVICE_TOKEN,
      useExisting: BundleDefinitionService,
    },
    {
      provide: BUNDLE_MASTER_SYNC_SERVICE_TOKEN,
      useExisting: BundleMasterSyncService,
    },
    {
      provide: BUNDLE_PRODUCT_CREATION_SERVICE_TOKEN,
      useExisting: BundleProductCreationService,
    },
  ],
  exports: [
    PRODUCT_REPOSITORY_TOKEN,
    PRODUCT_VARIANT_REPOSITORY_TOKEN,
    PRODUCTS_SERVICE_TOKEN,
    MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
    AUTO_MATCH_VARIANT_OFFERS_SERVICE_TOKEN,
    TAX_RATE_JOURNAL_SERVICE_TOKEN,
    TAX_RATE_JOURNAL_REPOSITORY_TOKEN,
    BUNDLE_DEFINITION_SERVICE_TOKEN,
    BUNDLE_DEFINITION_REPOSITORY_TOKEN,
    BUNDLE_MASTER_SYNC_SERVICE_TOKEN,
    BUNDLE_PRODUCT_CREATION_SERVICE_TOKEN,
  ],
})
export class ProductsModule {}

